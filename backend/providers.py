from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any
from urllib.parse import urlparse


@dataclass(frozen=True)
class Provider:
    id: str
    name: str
    base_url: str
    api_key: str
    default_model: str

    def public(self) -> dict[str, object]:
        return {
            "id": self.id,
            "name": self.name,
            "defaultModel": self.default_model,
            "hasApiKey": bool(self.api_key),
        }


def load_providers(
    raw: str,
    *,
    default_base_url: str,
    default_api_key: str,
    default_model: str,
) -> list[Provider]:
    providers = [
        Provider(
            id="default",
            name="Default",
            base_url=default_base_url.rstrip("/"),
            api_key=default_api_key,
            default_model=default_model,
        )
    ]
    if not raw.strip():
        return providers
    try:
        payload: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise ValueError("PROVIDERS_JSON must be valid JSON.") from exc
    if not isinstance(payload, list):
        raise ValueError("PROVIDERS_JSON must be a JSON array.")
    seen = {"default"}
    for item in payload:
        if not isinstance(item, dict):
            raise ValueError("Each provider must be a JSON object.")
        provider_id = str(item.get("id") or "").strip()
        name = str(item.get("name") or provider_id).strip()
        base_url = str(item.get("baseUrl") or "").strip().rstrip("/")
        api_key = str(item.get("apiKey") or "")
        provider_model = str(item.get("defaultModel") or default_model).strip()
        if not re.fullmatch(r"[a-zA-Z0-9_-]{1,50}", provider_id):
            raise ValueError("Provider ids must use letters, numbers, _ or -.")
        if provider_id in seen:
            raise ValueError(f"Duplicate provider id: {provider_id}")
        if not name or not base_url or not provider_model:
            raise ValueError("Provider name, baseUrl and defaultModel are required.")
        parsed = urlparse(base_url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError("Provider baseUrl must use HTTP or HTTPS.")
        seen.add(provider_id)
        providers.append(
            Provider(
                id=provider_id,
                name=name[:100],
                base_url=base_url,
                api_key=api_key,
                default_model=provider_model[:200],
            )
        )
    return providers


def find_provider(providers: list[Provider], provider_id: str | None) -> Provider:
    selected = provider_id or "default"
    for provider in providers:
        if provider.id == selected:
            return provider
    raise LookupError("Provider not found.")
