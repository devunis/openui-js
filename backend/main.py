from __future__ import annotations

import base64
import binascii
import json
import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Literal, Optional
from urllib.parse import urlparse

import httpx
from fastapi import (
    Cookie,
    Depends,
    FastAPI,
    File,
    HTTPException,
    Response as FastAPIResponse,
    UploadFile,
)
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from starlette.concurrency import run_in_threadpool

load_dotenv()

from backend import database
from backend.memory import build_memory_message
from backend.providers import Provider, find_provider, load_providers
from backend.rag import (
    MAX_FILE_BYTES,
    DocumentError,
    build_rag_message,
    chunk_text,
    clean_filename,
    extract_text,
)
from backend.security import (
    cookie_secure,
    create_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from backend.tools import ToolError, available_tools, execute_tool, load_mcp_servers
from backend.web_search import (
    WebSearchError,
    build_web_message,
    fetch_public_url,
    search_web,
)


class Settings:
    def __init__(self) -> None:
        self.api_base_url = os.getenv("API_BASE_URL", "http://localhost:11434/v1").rstrip("/")
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.default_model = os.getenv("DEFAULT_MODEL", "llama3.2")
        self.session_ttl_days = int(os.getenv("SESSION_TTL_DAYS", "30"))
        self.require_auth = os.getenv("REQUIRE_AUTH", "true").lower() in {
            "1",
            "true",
            "yes",
        }
        self.allow_registration = os.getenv("ALLOW_REGISTRATION", "true").lower() in {
            "1",
            "true",
            "yes",
        }
        self.enable_memories = os.getenv("ENABLE_MEMORIES", "true").lower() in {
            "1",
            "true",
            "yes",
        }
        self.memory_user_char_limit = int(os.getenv("MEMORY_USER_CHAR_LIMIT", "2000"))
        self.memory_context_char_limit = int(
            os.getenv("MEMORY_CONTEXT_CHAR_LIMIT", "2000")
        )
        self.enable_web_search = os.getenv("ENABLE_WEB_SEARCH", "false").lower() in {
            "1",
            "true",
            "yes",
        }
        self.web_search_provider = os.getenv("WEB_SEARCH_PROVIDER", "external").lower()
        self.web_search_url = os.getenv("WEB_SEARCH_URL", "")
        self.web_search_api_key = os.getenv("WEB_SEARCH_API_KEY", "")
        self.web_search_result_count = int(os.getenv("WEB_SEARCH_RESULT_COUNT", "5"))
        self.extra_providers = load_providers(
            os.getenv("PROVIDERS_JSON", ""),
            default_base_url=self.api_base_url,
            default_api_key=self.api_key,
            default_model=self.default_model,
        )[1:]
        self.mcp_servers = load_mcp_servers(os.getenv("MCP_SERVERS_JSON", ""))
        self.enable_tools = os.getenv("ENABLE_TOOLS", "true").lower() in {
            "1",
            "true",
            "yes",
        }
        self.cors_origins = [
            origin.strip()
            for origin in os.getenv(
                "CORS_ORIGINS",
                (
                    "http://127.0.0.1:3000,http://localhost:3000,"
                    "http://127.0.0.1:3001,http://localhost:3001"
                ),
            ).split(",")
            if origin.strip()
        ]


MAX_IMAGE_BYTES = 2 * 1024 * 1024


class WebSource(BaseModel):
    model_config = ConfigDict(extra="ignore")

    title: str = Field(min_length=1, max_length=300)
    url: str = Field(min_length=1, max_length=2_000)
    snippet: str = Field(default="", max_length=2_000)

    @field_validator("url")
    @classmethod
    def public_http_url(cls, value: str) -> str:
        parsed = urlparse(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("웹 출처는 HTTP 또는 HTTPS URL이어야 합니다.")
        return value


class ImageAttachment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=255)
    contentType: Literal["image/png", "image/jpeg", "image/webp", "image/gif"]
    dataUrl: str = Field(min_length=1, max_length=3_000_000)

    @model_validator(mode="after")
    def valid_data_url(self) -> "ImageAttachment":
        prefix = f"data:{self.contentType};base64,"
        if not self.dataUrl.startswith(prefix):
            raise ValueError("이미지 데이터 형식과 MIME 유형이 일치하지 않습니다.")
        try:
            decoded = base64.b64decode(self.dataUrl[len(prefix) :], validate=True)
        except (ValueError, binascii.Error) as exc:
            raise ValueError("유효하지 않은 base64 이미지입니다.") from exc
        if len(decoded) > MAX_IMAGE_BYTES:
            raise ValueError("이미지는 파일당 최대 2MB까지 첨부할 수 있습니다.")
        return self


class ToolEvent(BaseModel):
    model_config = ConfigDict(extra="ignore")

    name: str = Field(min_length=1, max_length=100)
    status: Literal["success", "error"]
    result: str = Field(default="", max_length=1_000)


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=100_000)
    attachments: list[ImageAttachment] = Field(default_factory=list, max_length=3)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(min_length=1, max_length=200)
    providerId: str = Field(default="default", min_length=1, max_length=50)
    messages: list[Message] = Field(min_length=1, max_length=500)
    temperature: float = Field(default=0.7, ge=0, le=2)
    documentIds: list[str] = Field(default_factory=list, max_length=50)
    useKnowledge: bool = False
    useMemory: bool = True
    useWeb: bool = False
    useTools: bool = False

    @model_validator(mode="after")
    def attachment_budget(self) -> "ChatRequest":
        attachments = [
            attachment
            for message in self.messages
            for attachment in message.attachments
        ]
        if len(attachments) > 12:
            raise ValueError("한 요청에는 이미지를 최대 12개까지 포함할 수 있습니다.")
        return self


class Credentials(BaseModel):
    email: str = Field(min_length=5, max_length=254)
    password: str = Field(min_length=8, max_length=128)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        normalized = value.strip().lower()
        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", normalized):
            raise ValueError("Invalid email address.")
        return normalized


class StoredMessage(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=100)
    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=100_000)
    sources: list[WebSource] = Field(default_factory=list, max_length=10)
    attachments: list[ImageAttachment] = Field(default_factory=list, max_length=3)
    toolEvents: list[ToolEvent] = Field(default_factory=list, max_length=20)
    createdAt: int = Field(ge=0)


class StoredChat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    model: str = Field(min_length=1, max_length=200)
    providerId: str = Field(default="default", min_length=1, max_length=50)
    useMemory: bool = True
    useWeb: bool = False
    useTools: bool = False
    archived: bool = False
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    messages: list[StoredMessage] = Field(max_length=1000)


class ChatSyncRequest(BaseModel):
    chats: list[StoredChat] = Field(max_length=500)


class RagSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10_000)
    documentIds: list[str] = Field(default_factory=list, max_length=50)
    limit: int = Field(default=5, ge=1, le=10)


class WebSearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10_000)


class WebFetchRequest(BaseModel):
    url: str = Field(min_length=1, max_length=2_000)


class MemoryCreateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4_000)
    type: Literal["user", "context"] = "user"
    sourceChatId: Optional[str] = Field(default=None, max_length=100)

    @field_validator("content")
    @classmethod
    def clean_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Memory content cannot be empty.")
        return cleaned


class MemoryUpdateRequest(BaseModel):
    content: str = Field(min_length=1, max_length=4_000)
    type: Literal["user", "context"] = "user"

    @field_validator("content")
    @classmethod
    def clean_content(cls, value: str) -> str:
        cleaned = value.strip()
        if not cleaned:
            raise ValueError("Memory content cannot be empty.")
        return cleaned


class MemorySearchRequest(BaseModel):
    query: str = Field(min_length=1, max_length=10_000)
    type: Optional[Literal["user", "context"]] = None
    limit: int = Field(default=5, ge=1, le=20)


settings = Settings()
app = FastAPI(
    title="OpenUI JS API",
    version="1.0.0",
    description="OpenAI-compatible API for the OpenUI JS React and vanilla frontends.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
database.init_db()

SESSION_COOKIE = "openui_session"


def configured_providers() -> list[Provider]:
    return [
        Provider(
            id="default",
            name="Default",
            base_url=settings.api_base_url,
            api_key=settings.api_key,
            default_model=settings.default_model,
        ),
        *settings.extra_providers,
    ]


def resolve_provider(provider_id: str | None) -> Provider:
    try:
        return find_provider(configured_providers(), provider_id)
    except LookupError:
        raise HTTPException(status_code=404, detail="Provider not found.")


def upstream_headers(provider: Provider) -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if provider.api_key:
        headers["Authorization"] = f"Bearer {provider.api_key}"
    return headers


def get_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))


def upstream_message(message: Message) -> dict[str, object]:
    if not message.attachments:
        return {"role": message.role, "content": message.content}
    content: list[dict[str, object]] = []
    if message.content:
        content.append({"type": "text", "text": message.content})
    content.extend(
        {
            "type": "image_url",
            "image_url": {"url": attachment.dataUrl},
        }
        for attachment in message.attachments
    )
    return {"role": message.role, "content": content}


def public_user(user: dict[str, object]) -> dict[str, object]:
    return {
        "id": user["id"],
        "email": user["email"],
        "createdAt": user["created_at"],
    }


def current_user(
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE),
) -> dict[str, object]:
    if not session_token:
        raise HTTPException(status_code=401, detail="Authentication required.")
    user = database.get_user_by_session(hash_session_token(session_token))
    if not user:
        raise HTTPException(status_code=401, detail="Session expired.")
    return user


def model_access(
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE),
) -> Optional[dict[str, object]]:
    if not settings.require_auth:
        if session_token:
            return database.get_user_by_session(hash_session_token(session_token))
        return None
    return current_user(session_token)


def set_session_cookie(response: FastAPIResponse, user_id: str) -> None:
    token = create_session_token()
    max_age = settings.session_ttl_days * 24 * 60 * 60
    database.create_session(
        hash_session_token(token),
        user_id,
        int(time.time()) + max_age,
    )
    response.set_cookie(
        key=SESSION_COOKIE,
        value=token,
        max_age=max_age,
        httponly=True,
        secure=cookie_secure(),
        samesite="lax",
        path="/",
    )


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config() -> dict[str, object]:
    return {
        "apiBaseUrl": settings.api_base_url,
        "defaultModel": settings.default_model,
        "hasApiKey": bool(settings.api_key),
        "authRequired": settings.require_auth,
        "registrationAllowed": settings.allow_registration,
        "memoriesEnabled": settings.enable_memories,
        "webSearchEnabled": settings.enable_web_search,
        "toolsEnabled": settings.enable_tools,
        "providers": [provider.public() for provider in configured_providers()],
    }


@app.post("/api/auth/register", status_code=201)
async def register(credentials: Credentials, response: FastAPIResponse) -> dict[str, object]:
    if not settings.allow_registration:
        raise HTTPException(status_code=403, detail="새 계정 가입이 비활성화되어 있습니다.")
    try:
        user = database.create_user(
            credentials.email,
            hash_password(credentials.password),
        )
    except sqlite3.IntegrityError:
        raise HTTPException(status_code=409, detail="이미 가입된 이메일입니다.")
    set_session_cookie(response, user["id"])
    return {"user": public_user(user)}


@app.post("/api/auth/login")
async def login(credentials: Credentials, response: FastAPIResponse) -> dict[str, object]:
    user = database.get_user_by_email(credentials.email)
    if not user or not verify_password(credentials.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="이메일 또는 비밀번호가 올바르지 않습니다.")
    set_session_cookie(response, user["id"])
    return {"user": public_user(user)}


@app.post("/api/auth/logout", status_code=204)
async def logout(
    response: FastAPIResponse,
    session_token: Optional[str] = Cookie(default=None, alias=SESSION_COOKIE),
) -> None:
    if session_token:
        database.delete_session(hash_session_token(session_token))
    response.delete_cookie(SESSION_COOKIE, path="/")


@app.get("/api/auth/me")
async def me(user: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    return {"user": public_user(user)}


@app.get("/api/chats")
async def get_chats(user: dict[str, object] = Depends(current_user)) -> dict[str, object]:
    return {"chats": database.list_chats(str(user["id"]))}


@app.get("/api/chats/search")
async def search_chat_history(
    q: str,
    include_archived: bool = True,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    query = q.strip()
    if not query:
        return {"chats": []}
    if len(query) > 500:
        raise HTTPException(status_code=422, detail="검색어가 너무 깁니다.")
    return {
        "chats": database.search_chats(
            str(user["id"]),
            query,
            include_archived,
        )
    }


@app.post("/api/chats/sync")
async def sync_chats(
    payload: ChatSyncRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    try:
        for chat in payload.chats:
            database.upsert_chat(str(user["id"]), chat.model_dump())
    except PermissionError:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return {"chats": database.list_chats(str(user["id"]))}


@app.put("/api/chats/{chat_id}")
async def save_chat(
    chat_id: str,
    chat: StoredChat,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    if chat_id != chat.id:
        raise HTTPException(status_code=400, detail="Chat id mismatch.")
    try:
        database.upsert_chat(str(user["id"]), chat.model_dump())
    except PermissionError:
        raise HTTPException(status_code=404, detail="Chat not found.")
    return {"chat": chat.model_dump()}


@app.get("/api/chats/{chat_id}/export")
async def export_chat(
    chat_id: str,
    format: Literal["markdown", "json"] = "markdown",
    user: dict[str, object] = Depends(current_user),
) -> Response:
    chat = database.get_chat(str(user["id"]), chat_id)
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found.")
    if format == "json":
        return Response(
            content=json.dumps(chat, ensure_ascii=False, indent=2),
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="chat-{chat_id}.json"'
            },
        )

    lines = [f"# {chat['title']}", "", f"Model: `{chat['model']}`", ""]
    for message in chat["messages"]:
        heading = {
            "system": "System",
            "user": "User",
            "assistant": "Assistant",
        }[message["role"]]
        lines.extend([f"## {heading}", "", message["content"] or ""])
        attachments = message.get("attachments") or []
        if attachments:
            lines.extend(
                ["", "Attachments:", *[f"- {item['name']}" for item in attachments]]
            )
        sources = message.get("sources") or []
        if sources:
            lines.extend(
                [
                    "",
                    "Sources:",
                    *[
                        f"- [{source['title']}]({source['url']})"
                        for source in sources
                    ],
                ]
            )
        lines.append("")
    return Response(
        content="\n".join(lines),
        media_type="text/markdown; charset=utf-8",
        headers={
            "Content-Disposition": f'attachment; filename="chat-{chat_id}.md"'
        },
    )


@app.delete("/api/chats/{chat_id}", status_code=204)
async def remove_chat(
    chat_id: str,
    user: dict[str, object] = Depends(current_user),
) -> None:
    database.delete_chat(str(user["id"]), chat_id)


@app.get("/api/documents")
async def get_documents(
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    return {"documents": database.list_documents(str(user["id"]))}


@app.post("/api/documents/upload", status_code=201)
async def upload_document(
    file: UploadFile = File(...),
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    filename = clean_filename(file.filename)
    try:
        content = await file.read(MAX_FILE_BYTES + 1)
    finally:
        await file.close()
    if len(content) > MAX_FILE_BYTES:
        raise HTTPException(status_code=413, detail="파일은 최대 10MB까지 업로드할 수 있습니다.")

    try:
        text, content_type = await run_in_threadpool(extract_text, filename, content)
        chunks = await run_in_threadpool(chunk_text, text)
    except DocumentError as exc:
        raise HTTPException(status_code=400, detail=str(exc))

    document = database.create_document(
        str(user["id"]),
        filename,
        content_type,
        len(content),
        chunks,
    )
    return {"document": document}


@app.delete("/api/documents/{document_id}", status_code=204)
async def remove_document(
    document_id: str,
    user: dict[str, object] = Depends(current_user),
) -> None:
    if not database.delete_document(str(user["id"]), document_id):
        raise HTTPException(status_code=404, detail="Document not found.")


@app.post("/api/rag/search")
async def search_knowledge(
    payload: RagSearchRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    results = database.search_document_chunks(
        str(user["id"]),
        payload.query,
        payload.documentIds or None,
        payload.limit,
    )
    return {"results": results}


def require_web_search_enabled() -> None:
    if not settings.enable_web_search:
        raise HTTPException(status_code=404, detail="Web search feature is disabled.")


@app.post("/api/web/search")
async def search_live_web(
    payload: WebSearchRequest,
    _user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_web_search_enabled()
    try:
        results = await search_web(
            payload.query,
            provider=settings.web_search_provider,
            url=settings.web_search_url,
            api_key=settings.web_search_api_key,
            result_count=settings.web_search_result_count,
        )
    except (WebSearchError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    return {"results": results}


@app.post("/api/web/fetch")
async def fetch_web_page(
    payload: WebFetchRequest,
    _user: dict[str, object] = Depends(current_user),
) -> dict[str, str]:
    require_web_search_enabled()
    try:
        return await fetch_public_url(payload.url)
    except (WebSearchError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))


@app.post("/api/web/save", status_code=201)
async def save_web_page(
    payload: WebFetchRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_web_search_enabled()
    try:
        page = await fetch_public_url(payload.url)
        chunks = await run_in_threadpool(chunk_text, page["content"])
    except (WebSearchError, DocumentError, httpx.HTTPError) as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    parsed = urlparse(page["url"])
    path_name = Path(parsed.path).stem or "page"
    filename = clean_filename(f"web-{parsed.hostname or 'page'}-{path_name}.txt")
    document = database.create_document(
        str(user["id"]),
        filename,
        "text/plain",
        len(page["content"].encode("utf-8")),
        chunks,
    )
    return {"document": document, "url": page["url"]}


def require_memories_enabled() -> None:
    if not settings.enable_memories:
        raise HTTPException(status_code=404, detail="Memory feature is disabled.")


@app.get("/api/memories")
async def get_memories(
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_memories_enabled()
    return {"memories": database.list_memories(str(user["id"]))}


@app.post("/api/memories", status_code=201)
async def add_memory(
    payload: MemoryCreateRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_memories_enabled()
    memory = database.create_memory(
        str(user["id"]),
        payload.type,
        payload.content,
        payload.sourceChatId,
    )
    return {"memory": memory}


@app.put("/api/memories/{memory_id}")
async def edit_memory(
    memory_id: str,
    payload: MemoryUpdateRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_memories_enabled()
    memory = database.update_memory(
        str(user["id"]),
        memory_id,
        payload.type,
        payload.content,
    )
    if not memory:
        raise HTTPException(status_code=404, detail="Memory not found.")
    return {"memory": memory}


@app.delete("/api/memories/{memory_id}", status_code=204)
async def remove_memory(
    memory_id: str,
    user: dict[str, object] = Depends(current_user),
) -> None:
    require_memories_enabled()
    if not database.delete_memory(str(user["id"]), memory_id):
        raise HTTPException(status_code=404, detail="Memory not found.")


@app.delete("/api/memories", status_code=204)
async def remove_all_memories(
    user: dict[str, object] = Depends(current_user),
) -> None:
    require_memories_enabled()
    database.clear_memories(str(user["id"]))


@app.post("/api/memories/search")
async def search_memory_bank(
    payload: MemorySearchRequest,
    user: dict[str, object] = Depends(current_user),
) -> dict[str, object]:
    require_memories_enabled()
    memories = database.search_memories(
        str(user["id"]),
        payload.query,
        payload.type,
        payload.limit,
    )
    return {"memories": memories}


@app.get("/api/models")
async def models(
    providerId: str = "default",
    _user: Optional[dict[str, object]] = Depends(model_access),
) -> Response:
    provider = resolve_provider(providerId)
    try:
        async with get_http_client() as client:
            upstream = await client.get(
                f"{provider.base_url}/models",
                headers=upstream_headers(provider),
            )
        return Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
        )
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"모델 서버에 연결하지 못했습니다: {exc}"}},
        )


@app.get("/api/tools")
async def get_tools(
    _user: Optional[dict[str, object]] = Depends(model_access),
) -> dict[str, object]:
    if not settings.enable_tools:
        raise HTTPException(status_code=404, detail="Tool use is disabled.")
    tools = await available_tools(settings.mcp_servers)
    return {
        "tools": [
            {
                "name": tool["function"]["name"],
                "description": tool["function"].get("description", ""),
            }
            for tool in tools
        ]
    }


async def tool_completion_response(
    provider: Provider,
    payload: ChatRequest,
    messages: list[dict[str, object]],
    web_sources: list[dict[str, str]],
) -> Response:
    if not settings.enable_tools:
        raise HTTPException(status_code=404, detail="Tool use is disabled.")
    tools = await available_tools(settings.mcp_servers)
    tool_messages = list(messages)
    tool_events: list[dict[str, str]] = []
    final_content = ""

    try:
        async with get_http_client() as client:
            for _round in range(4):
                upstream = await client.post(
                    f"{provider.base_url}/chat/completions",
                    headers=upstream_headers(provider),
                    json={
                        "model": payload.model,
                        "messages": tool_messages,
                        "tools": tools,
                        "tool_choice": "auto",
                        "stream": False,
                        "temperature": payload.temperature,
                    },
                )
                if not upstream.is_success:
                    return Response(
                        content=upstream.content,
                        status_code=upstream.status_code,
                        media_type=upstream.headers.get(
                            "content-type", "application/json"
                        ),
                    )
                try:
                    assistant = upstream.json()["choices"][0]["message"]
                except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                    return JSONResponse(
                        status_code=502,
                        content={"error": {"message": "모델의 도구 응답 형식이 올바르지 않습니다."}},
                    )
                if not isinstance(assistant, dict):
                    return JSONResponse(
                        status_code=502,
                        content={"error": {"message": "모델의 message 형식이 올바르지 않습니다."}},
                    )
                calls = assistant.get("tool_calls") or []
                if not isinstance(calls, list):
                    return JSONResponse(
                        status_code=502,
                        content={"error": {"message": "모델의 tool_calls 형식이 올바르지 않습니다."}},
                    )
                if len(calls) > 8:
                    return JSONResponse(
                        status_code=502,
                        content={"error": {"message": "한 번에 요청된 도구 호출이 너무 많습니다."}},
                    )
                if not calls:
                    final_content = str(assistant.get("content") or "")
                    break
                tool_messages.append(assistant)
                for call in calls:
                    if not isinstance(call, dict):
                        return JSONResponse(
                            status_code=502,
                            content={"error": {"message": "잘못된 도구 호출 항목입니다."}},
                        )
                    function = call.get("function") or {}
                    if not isinstance(function, dict):
                        return JSONResponse(
                            status_code=502,
                            content={"error": {"message": "잘못된 도구 함수 항목입니다."}},
                        )
                    name = str(function.get("name") or "")
                    try:
                        arguments = json.loads(function.get("arguments") or "{}")
                        if not isinstance(arguments, dict):
                            raise ToolError("Tool arguments must be an object.")
                        result = await execute_tool(name, arguments, settings.mcp_servers)
                        serialized = json.dumps(result, ensure_ascii=False, default=str)
                        status = "success"
                    except (
                        ToolError,
                        httpx.HTTPError,
                        json.JSONDecodeError,
                    ) as exc:
                        serialized = json.dumps(
                            {"error": str(exc)},
                            ensure_ascii=False,
                        )
                        status = "error"
                    serialized = serialized[:20_000]
                    tool_events.append(
                        {
                            "name": name,
                            "status": status,
                            "result": serialized[:500],
                        }
                    )
                    tool_messages.append(
                        {
                            "role": "tool",
                            "tool_call_id": str(call.get("id") or ""),
                            "content": serialized,
                        }
                    )
            else:
                final_content = "도구 호출 횟수 제한에 도달했습니다."
    except httpx.HTTPError as exc:
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"모델 서버에 연결하지 못했습니다: {exc}"}},
        )

    async def stream():
        metadata: dict[str, object] = {}
        if web_sources:
            metadata["sources"] = web_sources
        if tool_events:
            metadata["toolEvents"] = tool_events
        if metadata:
            yield (
                "data: "
                + json.dumps({"openui": metadata}, ensure_ascii=False)
                + "\n\n"
            ).encode()
        if final_content:
            yield (
                "data: "
                + json.dumps(
                    {"choices": [{"delta": {"content": final_content}}]},
                    ensure_ascii=False,
                )
                + "\n\n"
            ).encode()
        yield b"data: [DONE]\n\n"

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


@app.post("/api/chat/completions")
async def chat_completions(
    payload: ChatRequest,
    _user: Optional[dict[str, object]] = Depends(model_access),
) -> Response:
    provider = resolve_provider(payload.providerId)
    messages = [upstream_message(message) for message in payload.messages]
    web_sources: list[dict[str, str]] = []
    user_message = next(
        (
            message.content
            for message in reversed(payload.messages)
            if message.role == "user"
        ),
        "",
    )
    if payload.useWeb:
        if not settings.enable_web_search:
            raise HTTPException(status_code=404, detail="Web search feature is disabled.")
        try:
            web_sources = await search_web(
                user_message,
                provider=settings.web_search_provider,
                url=settings.web_search_url,
                api_key=settings.web_search_api_key,
                result_count=settings.web_search_result_count,
            )
        except (WebSearchError, httpx.HTTPError) as exc:
            raise HTTPException(status_code=502, detail=str(exc))
        if web_sources:
            messages.insert(
                0,
                {"role": "system", "content": build_web_message(web_sources)},
            )
    if payload.useMemory and settings.enable_memories and _user:
        user_memories = database.memories_for_prompt(
            str(_user["id"]),
            "user",
            settings.memory_user_char_limit,
        )
        context_memories = database.search_memories(
            str(_user["id"]),
            user_message,
            "context",
            5,
            settings.memory_context_char_limit,
        )
        if user_memories or context_memories:
            messages.insert(
                0,
                {
                    "role": "system",
                    "content": build_memory_message(user_memories, context_memories),
                },
            )
    if payload.useKnowledge and _user:
        results = database.search_document_chunks(
            str(_user["id"]),
            user_message,
            payload.documentIds or None,
            5,
        )
        if results:
            messages.insert(0, {"role": "system", "content": build_rag_message(results)})

    if payload.useTools:
        return await tool_completion_response(provider, payload, messages, web_sources)

    client = get_http_client()
    request = client.build_request(
        "POST",
        f"{provider.base_url}/chat/completions",
        headers=upstream_headers(provider),
        json={
            "model": payload.model,
            "messages": messages,
            "stream": True,
            "temperature": payload.temperature,
        },
    )

    try:
        upstream = await client.send(request, stream=True)
    except httpx.HTTPError as exc:
        await client.aclose()
        return JSONResponse(
            status_code=502,
            content={"error": {"message": f"모델 서버에 연결하지 못했습니다: {exc}"}},
        )

    if not upstream.is_success:
        content = await upstream.aread()
        await upstream.aclose()
        await client.aclose()
        return Response(
            content=content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type", "application/json"),
        )

    async def stream():
        try:
            if web_sources:
                metadata = json.dumps(
                    {"openui": {"sources": web_sources}},
                    ensure_ascii=False,
                )
                yield f"data: {metadata}\n\n".encode()
            async for chunk in upstream.aiter_bytes():
                yield chunk
        finally:
            await upstream.aclose()
            await client.aclose()

    return StreamingResponse(
        stream(),
        media_type=upstream.headers.get("content-type", "text/event-stream"),
        headers={"Cache-Control": "no-cache, no-transform", "X-Accel-Buffering": "no"},
    )


dist_path = Path(__file__).resolve().parents[1] / "dist"
react_dist = dist_path / "react"
vanilla_dist = dist_path / "vanilla"


@app.get("/", include_in_schema=False)
async def frontend_home() -> RedirectResponse:
    return RedirectResponse("/react/")


if react_dist.exists():
    app.mount("/react", StaticFiles(directory=react_dist, html=True), name="react-frontend")
if vanilla_dist.exists():
    app.mount(
        "/vanilla",
        StaticFiles(directory=vanilla_dist, html=True),
        name="vanilla-frontend",
    )
