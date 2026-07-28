from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field

load_dotenv()


class Settings:
    def __init__(self) -> None:
        self.api_base_url = os.getenv("API_BASE_URL", "http://localhost:11434/v1").rstrip("/")
        self.api_key = os.getenv("OPENAI_API_KEY", "")
        self.default_model = os.getenv("DEFAULT_MODEL", "llama3.2")


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=100_000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(min_length=1, max_length=200)
    messages: list[Message] = Field(min_length=1, max_length=500)
    temperature: float = Field(default=0.7, ge=0, le=2)


settings = Settings()
app = FastAPI(
    title="OpenUI JS API",
    version="1.0.0",
    description="OpenAI-compatible streaming proxy for the OpenUI JS React frontend.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:3000", "http://localhost:3000"],
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


def upstream_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    return headers


def get_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))


@app.get("/api/health")
async def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/config")
async def config() -> dict[str, object]:
    return {
        "apiBaseUrl": settings.api_base_url,
        "defaultModel": settings.default_model,
        "hasApiKey": bool(settings.api_key),
    }


@app.get("/api/models")
async def models() -> Response:
    try:
        async with get_http_client() as client:
            upstream = await client.get(
                f"{settings.api_base_url}/models",
                headers=upstream_headers(),
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


@app.post("/api/chat/completions")
async def chat_completions(payload: ChatRequest) -> Response:
    client = get_http_client()
    request = client.build_request(
        "POST",
        f"{settings.api_base_url}/chat/completions",
        headers=upstream_headers(),
        json={
            "model": payload.model,
            "messages": [message.model_dump() for message in payload.messages],
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
