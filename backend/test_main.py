import json

import httpx
import pytest
from fastapi.testclient import TestClient

from backend import main


def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


@pytest.fixture(autouse=True)
def isolated_database(tmp_path, monkeypatch):
    monkeypatch.setattr(main.database, "DATABASE_PATH", tmp_path / "test.db")
    monkeypatch.setattr(main.settings, "require_auth", True)
    monkeypatch.setattr(main.settings, "allow_registration", True)
    main.database.init_db()


def register_client(client, email="hello@example.com"):
    response = client.post(
        "/api/auth/register",
        json={"email": email, "password": "correct-horse"},
    )
    assert response.status_code == 201


def test_config_does_not_expose_api_key(monkeypatch):
    monkeypatch.setattr(main.settings, "api_base_url", "http://model.test/v1")
    monkeypatch.setattr(main.settings, "api_key", "secret-token")
    monkeypatch.setattr(main.settings, "default_model", "tiny-model")

    response = TestClient(main.app).get("/api/config")

    assert response.status_code == 200
    assert response.json() == {
        "apiBaseUrl": "http://model.test/v1",
        "defaultModel": "tiny-model",
        "hasApiKey": True,
        "authRequired": True,
        "registrationAllowed": True,
    }
    assert "secret-token" not in response.text


def test_models_are_proxied(monkeypatch):
    async def handler(request):
        assert str(request.url) == "http://model.test/v1/models"
        return httpx.Response(200, json={"data": [{"id": "model-a"}]})

    monkeypatch.setattr(main.settings, "api_base_url", "http://model.test/v1")
    monkeypatch.setattr(main, "get_http_client", lambda: mock_client(handler))
    client = TestClient(main.app)
    register_client(client)

    response = client.get("/api/models")

    assert response.status_code == 200
    assert response.json() == {"data": [{"id": "model-a"}]}


def test_chat_completions_stream(monkeypatch):
    async def handler(request):
        body = json.loads(request.content)
        assert body["model"] == "model-a"
        assert body["stream"] is True
        return httpx.Response(
            200,
            content=b'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]\n\n',
            headers={"content-type": "text/event-stream"},
        )

    monkeypatch.setattr(main.settings, "api_base_url", "http://model.test/v1")
    monkeypatch.setattr(main, "get_http_client", lambda: mock_client(handler))
    client = TestClient(main.app)
    register_client(client)

    with client.stream(
        "POST",
        "/api/chat/completions",
        json={
            "model": "model-a",
            "messages": [{"role": "user", "content": "hi"}],
        },
    ) as response:
        assert response.status_code == 200
        response.read()
        assert "hello" in response.text


def test_invalid_chat_payload_is_rejected():
    client = TestClient(main.app)
    register_client(client)
    response = client.post(
        "/api/chat/completions",
        json={"model": "", "messages": []},
    )

    assert response.status_code == 422


def test_register_session_and_logout():
    client = TestClient(main.app)

    register = client.post(
        "/api/auth/register",
        json={"email": "hello@example.com", "password": "correct-horse"},
    )
    me = client.get("/api/auth/me")
    logout = client.post("/api/auth/logout")
    after_logout = client.get("/api/auth/me")

    assert register.status_code == 201
    assert register.json()["user"]["email"] == "hello@example.com"
    assert "openui_session" in register.cookies
    assert "HttpOnly" in register.headers["set-cookie"]
    assert "SameSite=lax" in register.headers["set-cookie"]
    assert me.status_code == 200
    assert logout.status_code == 204
    assert after_logout.status_code == 401


def test_duplicate_registration_and_invalid_login():
    client = TestClient(main.app)
    credentials = {"email": "hello@example.com", "password": "correct-horse"}

    assert client.post("/api/auth/register", json=credentials).status_code == 201
    assert client.post("/api/auth/register", json=credentials).status_code == 409
    client.post("/api/auth/logout")
    invalid = client.post(
        "/api/auth/login",
        json={"email": "hello@example.com", "password": "wrong-password"},
    )

    assert invalid.status_code == 401


def test_registration_can_be_disabled(monkeypatch):
    monkeypatch.setattr(main.settings, "allow_registration", False)

    response = TestClient(main.app).post(
        "/api/auth/register",
        json={"email": "hello@example.com", "password": "correct-horse"},
    )

    assert response.status_code == 403


def test_chats_are_persisted_and_isolated_by_user():
    first = TestClient(main.app)
    second = TestClient(main.app)
    assert first.post(
        "/api/auth/register",
        json={"email": "first@example.com", "password": "correct-horse"},
    ).status_code == 201
    assert second.post(
        "/api/auth/register",
        json={"email": "second@example.com", "password": "correct-horse"},
    ).status_code == 201

    chat = {
        "id": "chat-1",
        "title": "Persist me",
        "model": "model-a",
        "createdAt": 100,
        "updatedAt": 200,
        "messages": [
            {
                "id": "message-1",
                "role": "user",
                "content": "hello",
                "createdAt": 150,
            }
        ],
    }
    sync = first.post("/api/chats/sync", json={"chats": [chat]})

    assert sync.status_code == 200
    assert sync.json()["chats"][0]["messages"][0]["content"] == "hello"
    assert first.get("/api/chats").json()["chats"][0]["id"] == "chat-1"
    assert second.get("/api/chats").json()["chats"] == []

    foreign_update = second.put("/api/chats/chat-1", json=chat)
    assert foreign_update.status_code == 404

    assert first.delete("/api/chats/chat-1").status_code == 204
    assert first.get("/api/chats").json()["chats"] == []


def test_chat_storage_requires_authentication():
    client = TestClient(main.app)

    assert client.get("/api/chats").status_code == 401
    assert client.post("/api/chats/sync", json={"chats": []}).status_code == 401
    assert client.delete("/api/chats/missing").status_code == 401
    assert client.get("/api/models").status_code == 401
    assert client.post(
        "/api/chat/completions",
        json={
            "model": "model-a",
            "messages": [{"role": "user", "content": "hello"}],
        },
    ).status_code == 401


def test_built_frontends_are_served():
    client = TestClient(main.app)

    home = client.get("/", follow_redirects=False)
    react = client.get("/react/")
    vanilla = client.get("/vanilla/")

    assert home.status_code == 307
    assert home.headers["location"] == "/react/"
    assert react.status_code == 200
    assert "OpenUI JS" in react.text
    assert vanilla.status_code == 200
    assert "OpenUI JS" in vanilla.text
