import json

import httpx
from fastapi.testclient import TestClient

from backend import main


def mock_client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


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
    }
    assert "secret-token" not in response.text


def test_models_are_proxied(monkeypatch):
    async def handler(request):
        assert str(request.url) == "http://model.test/v1/models"
        return httpx.Response(200, json={"data": [{"id": "model-a"}]})

    monkeypatch.setattr(main.settings, "api_base_url", "http://model.test/v1")
    monkeypatch.setattr(main, "get_http_client", lambda: mock_client(handler))

    response = TestClient(main.app).get("/api/models")

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

    with TestClient(main.app).stream(
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
    response = TestClient(main.app).post(
        "/api/chat/completions",
        json={"model": "", "messages": []},
    )

    assert response.status_code == 422


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
