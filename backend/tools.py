from __future__ import annotations

import ast
import json
import operator
import re
from dataclasses import dataclass
from datetime import datetime
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import httpx


class ToolError(ValueError):
    pass


@dataclass(frozen=True)
class McpServer:
    id: str
    name: str
    url: str
    headers: dict[str, str]
    allowed_tools: tuple[str, ...]


BUILTIN_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "builtin__calculator",
            "description": "Evaluate a basic arithmetic expression.",
            "parameters": {
                "type": "object",
                "properties": {
                    "expression": {
                        "type": "string",
                        "description": "Arithmetic expression using numbers and + - * / // % **.",
                    }
                },
                "required": ["expression"],
                "additionalProperties": False,
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "builtin__current_time",
            "description": "Get the current date and time in an IANA timezone.",
            "parameters": {
                "type": "object",
                "properties": {
                    "timezone": {
                        "type": "string",
                        "description": "IANA timezone such as Asia/Seoul or UTC.",
                    }
                },
                "required": ["timezone"],
                "additionalProperties": False,
            },
        },
    },
]

_BINARY_OPERATORS = {
    ast.Add: operator.add,
    ast.Sub: operator.sub,
    ast.Mult: operator.mul,
    ast.Div: operator.truediv,
    ast.FloorDiv: operator.floordiv,
    ast.Mod: operator.mod,
    ast.Pow: operator.pow,
}
_UNARY_OPERATORS = {ast.UAdd: operator.pos, ast.USub: operator.neg}


def load_mcp_servers(raw: str) -> list[McpServer]:
    if not raw.strip():
        return []
    try:
        payload: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("MCP_SERVERS_JSON must be valid JSON.") from exc
    if not isinstance(payload, list):
        raise ValueError("MCP_SERVERS_JSON must be a JSON array.")
    servers: list[McpServer] = []
    seen: set[str] = set()
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Each MCP server must be a JSON object.")
        server_id = str(item.get("id") or "").strip()
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,30}", server_id):
            raise ValueError("MCP server ids must use letters, numbers, _ or -.")
        if server_id in seen:
            raise ValueError(f"Duplicate MCP server id: {server_id}")
        url = str(item.get("url") or "").strip()
        if not url.startswith(("http://", "https://")):
            raise ValueError("MCP server URL must use HTTP or HTTPS.")
        headers = item.get("headers") or {}
        allowed = item.get("allowedTools") or []
        if not isinstance(headers, dict) or not isinstance(allowed, list):
            raise ValueError("MCP headers and allowedTools have invalid formats.")
        if any(
            not re.fullmatch(r"[a-zA-Z0-9_-]{1,40}", str(name))
            or len(f"mcp_{server_id}__{name}") > 64
            for name in allowed
        ):
            raise ValueError(
                "Allowlisted MCP tool names must use letters, numbers, _ or -."
            )
        seen.add(server_id)
        servers.append(
            McpServer(
                id=server_id,
                name=str(item.get("name") or server_id)[:100],
                url=url,
                headers={str(key): str(value) for key, value in headers.items()},
                allowed_tools=tuple(str(name) for name in allowed),
            )
        )
    return servers


def _evaluate(node: ast.AST) -> float | int:
    if isinstance(node, ast.Expression):
        return _evaluate(node.body)
    if isinstance(node, ast.Constant) and type(node.value) in {int, float}:
        return node.value
    if isinstance(node, ast.UnaryOp) and type(node.op) in _UNARY_OPERATORS:
        return _UNARY_OPERATORS[type(node.op)](_evaluate(node.operand))
    if isinstance(node, ast.BinOp) and type(node.op) in _BINARY_OPERATORS:
        left = _evaluate(node.left)
        right = _evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 12:
            raise ToolError("Exponent is too large.")
        result = _BINARY_OPERATORS[type(node.op)](left, right)
        if abs(result) > 1e100:
            raise ToolError("Result is too large.")
        return result
    raise ToolError("Unsupported arithmetic expression.")


def calculate(expression: str) -> str:
    if len(expression) > 200:
        raise ToolError("Expression is too long.")
    try:
        parsed = ast.parse(expression, mode="eval")
        result = _evaluate(parsed)
    except (SyntaxError, ArithmeticError, OverflowError) as exc:
        raise ToolError("Invalid arithmetic expression.") from exc
    return str(result)


def current_time(timezone: str) -> str:
    try:
        zone = ZoneInfo(timezone)
    except ZoneInfoNotFoundError as exc:
        raise ToolError("Unknown timezone.") from exc
    return datetime.now(zone).isoformat(timespec="seconds")


def _json_rpc_payload(method: str, params: dict[str, object], request_id: int) -> dict[str, object]:
    return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}


def _parse_rpc_response(response: httpx.Response) -> dict[str, Any]:
    if not response.is_success:
        raise ToolError(f"MCP server returned HTTP {response.status_code}.")
    content_type = response.headers.get("content-type", "")
    if "text/event-stream" in content_type:
        for line in response.text.splitlines():
            if line.startswith("data:"):
                try:
                    payload = json.loads(line[5:].strip())
                except json.JSONDecodeError as exc:
                    raise ToolError("MCP server returned invalid event data.") from exc
                if isinstance(payload, dict):
                    return payload
        raise ToolError("MCP server returned an empty event stream.")
    try:
        payload = response.json()
    except json.JSONDecodeError as exc:
        raise ToolError("MCP server did not return JSON.") from exc
    if not isinstance(payload, dict):
        raise ToolError("MCP server returned an invalid response.")
    return payload


async def _mcp_session(server: McpServer) -> tuple[httpx.AsyncClient, dict[str, str]]:
    client = httpx.AsyncClient(timeout=httpx.Timeout(20.0, connect=5.0))
    headers = {
        "Accept": "application/json, text/event-stream",
        "Content-Type": "application/json",
        **server.headers,
    }
    try:
        response = await client.post(
            server.url,
            headers=headers,
            json=_json_rpc_payload(
                "initialize",
                {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "openui-js", "version": "1.0.0"},
                },
                1,
            ),
        )
        payload = _parse_rpc_response(response)
        if payload.get("error"):
            raise ToolError(str(payload["error"]))
        session_id = response.headers.get("mcp-session-id")
        if session_id:
            headers["Mcp-Session-Id"] = session_id
        await client.post(
            server.url,
            headers=headers,
            json={"jsonrpc": "2.0", "method": "notifications/initialized"},
        )
    except Exception:
        await client.aclose()
        raise
    return client, headers


async def list_mcp_tools(server: McpServer) -> list[dict[str, object]]:
    client, headers = await _mcp_session(server)
    try:
        response = await client.post(
            server.url,
            headers=headers,
            json=_json_rpc_payload("tools/list", {}, 2),
        )
        payload = _parse_rpc_response(response)
    finally:
        await client.aclose()
    result = payload.get("result")
    tools = result.get("tools", []) if isinstance(result, dict) else []
    exposed: list[dict[str, object]] = []
    for tool in tools if isinstance(tools, list) else []:
        if not isinstance(tool, dict):
            continue
        name = str(tool.get("name") or "")
        if name not in server.allowed_tools:
            continue
        exposed.append(
            {
                "type": "function",
                "function": {
                    "name": f"mcp_{server.id}__{name}",
                    "description": str(tool.get("description") or "")[:1_000],
                    "parameters": tool.get("inputSchema")
                    if isinstance(tool.get("inputSchema"), dict)
                    else {"type": "object", "properties": {}},
                },
            }
        )
    return exposed


async def call_mcp_tool(
    server: McpServer,
    tool_name: str,
    arguments: dict[str, object],
) -> object:
    if tool_name not in server.allowed_tools:
        raise ToolError("MCP tool is not allowlisted.")
    client, headers = await _mcp_session(server)
    try:
        response = await client.post(
            server.url,
            headers=headers,
            json=_json_rpc_payload(
                "tools/call",
                {"name": tool_name, "arguments": arguments},
                2,
            ),
        )
        payload = _parse_rpc_response(response)
    finally:
        await client.aclose()
    if payload.get("error"):
        raise ToolError(str(payload["error"]))
    return payload.get("result")


async def available_tools(servers: list[McpServer]) -> list[dict[str, object]]:
    tools = list(BUILTIN_TOOLS)
    for server in servers:
        try:
            tools.extend(await list_mcp_tools(server))
        except (ToolError, httpx.HTTPError):
            continue
    return tools


async def execute_tool(
    name: str,
    arguments: dict[str, object],
    servers: list[McpServer],
) -> object:
    if name == "builtin__calculator":
        return {"result": calculate(str(arguments.get("expression") or ""))}
    if name == "builtin__current_time":
        return {"result": current_time(str(arguments.get("timezone") or "UTC"))}
    match = re.fullmatch(r"mcp_([a-zA-Z0-9_-]+)__(.+)", name)
    if not match:
        raise ToolError("Unknown tool.")
    server = next((item for item in servers if item.id == match.group(1)), None)
    if not server:
        raise ToolError("MCP server not found.")
    return await call_mcp_tool(server, match.group(2), arguments)
