from __future__ import annotations

import os
import re
import sqlite3
import time
from pathlib import Path
from typing import Literal, Optional

import httpx
from fastapi import Cookie, Depends, FastAPI, HTTPException, Response as FastAPIResponse
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles
from dotenv import load_dotenv
from pydantic import BaseModel, ConfigDict, Field, field_validator

load_dotenv()

from backend import database
from backend.security import (
    cookie_secure,
    create_session_token,
    hash_password,
    hash_session_token,
    verify_password,
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


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")

    role: Literal["system", "user", "assistant"]
    content: str = Field(max_length=100_000)


class ChatRequest(BaseModel):
    model_config = ConfigDict(extra="ignore")

    model: str = Field(min_length=1, max_length=200)
    messages: list[Message] = Field(min_length=1, max_length=500)
    temperature: float = Field(default=0.7, ge=0, le=2)


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
    createdAt: int = Field(ge=0)


class StoredChat(BaseModel):
    model_config = ConfigDict(extra="ignore")

    id: str = Field(min_length=1, max_length=100)
    title: str = Field(min_length=1, max_length=200)
    model: str = Field(min_length=1, max_length=200)
    createdAt: int = Field(ge=0)
    updatedAt: int = Field(ge=0)
    messages: list[StoredMessage] = Field(max_length=1000)


class ChatSyncRequest(BaseModel):
    chats: list[StoredChat] = Field(max_length=500)


settings = Settings()
app = FastAPI(
    title="OpenUI JS API",
    version="1.0.0",
    description="OpenAI-compatible API for the OpenUI JS React and vanilla frontends.",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://127.0.0.1:3000",
        "http://localhost:3000",
        "http://127.0.0.1:3001",
        "http://localhost:3001",
    ],
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type"],
)
database.init_db()

SESSION_COOKIE = "openui_session"


def upstream_headers() -> dict[str, str]:
    headers = {"Content-Type": "application/json"}
    if settings.api_key:
        headers["Authorization"] = f"Bearer {settings.api_key}"
    return headers


def get_http_client() -> httpx.AsyncClient:
    return httpx.AsyncClient(timeout=httpx.Timeout(60.0, connect=10.0))


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


@app.delete("/api/chats/{chat_id}", status_code=204)
async def remove_chat(
    chat_id: str,
    user: dict[str, object] = Depends(current_user),
) -> None:
    database.delete_chat(str(user["id"]), chat_id)


@app.get("/api/models")
async def models(_user: Optional[dict[str, object]] = Depends(model_access)) -> Response:
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
async def chat_completions(
    payload: ChatRequest,
    _user: Optional[dict[str, object]] = Depends(model_access),
) -> Response:
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
