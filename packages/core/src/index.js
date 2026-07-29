export class OpenUIError extends Error {
  constructor(message, status = 0, payload = null) {
    super(message);
    this.name = "OpenUIError";
    this.status = status;
    this.payload = payload;
  }
}

export async function* parseEventStream(body) {
  if (!body?.getReader) throw new TypeError("A readable response body is required.");
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (!data) continue;
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // Provider keep-alives and non-JSON events are intentionally ignored.
        }
      }
      if (done) {
        const trimmed = buffer.trim();
        if (trimmed.startsWith("data:")) {
          const data = trimmed.slice(5).trim();
          if (data && data !== "[DONE]") {
            try {
              yield JSON.parse(data);
            } catch {
              // Ignore a trailing provider-specific event.
            }
          }
        }
        return;
      }
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // The stream may already be closed or errored.
    }
    reader.releaseLock();
  }
}

export class OpenUIClient {
  constructor({
    baseUrl = "",
    fetch: fetchImplementation = globalThis.fetch,
    credentials = "include",
    headers = {}
  } = {}) {
    if (typeof fetchImplementation !== "function") {
      throw new TypeError("A fetch implementation is required.");
    }
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.fetch = fetchImplementation;
    this.credentials = credentials;
    this.headers = { ...headers };
  }

  url(path) {
    return `${this.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
  }

  async request(path, options = {}) {
    const response = await this.fetch(this.url(path), {
      credentials: this.credentials,
      ...options,
      headers: {
        ...this.headers,
        ...(typeof FormData !== "undefined" && options.body instanceof FormData
          ? {}
          : options.body
            ? { "Content-Type": "application/json" }
            : {}),
        ...options.headers
      }
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new OpenUIError(
        payload?.error?.message || payload?.detail || `Request failed (${response.status})`,
        response.status,
        payload
      );
    }
    if (response.status === 204) return null;
    return response.json();
  }

  config() {
    return this.request("/api/config");
  }

  models(providerId = "default") {
    return this.request(
      `/api/models?providerId=${encodeURIComponent(providerId)}`
    );
  }

  tools() {
    return this.request("/api/tools");
  }

  me() {
    return this.request("/api/auth/me");
  }

  login(email, password) {
    return this.request("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  }

  register(email, password) {
    return this.request("/api/auth/register", {
      method: "POST",
      body: JSON.stringify({ email, password })
    });
  }

  logout() {
    return this.request("/api/auth/logout", { method: "POST" });
  }

  chats() {
    return this.request("/api/chats");
  }

  saveChat(chat) {
    return this.request(`/api/chats/${encodeURIComponent(chat.id)}`, {
      method: "PUT",
      body: JSON.stringify(chat)
    });
  }

  deleteChat(chatId) {
    return this.request(`/api/chats/${encodeURIComponent(chatId)}`, {
      method: "DELETE"
    });
  }

  searchChats(query, includeArchived = true) {
    return this.request(
      `/api/chats/search?q=${encodeURIComponent(query)}&include_archived=${includeArchived}`
    );
  }

  async *streamChat(payload, { signal, onSources, onTools } = {}) {
    const response = await this.fetch(this.url("/api/chat/completions"), {
      method: "POST",
      credentials: this.credentials,
      headers: { "Content-Type": "application/json", ...this.headers },
      body: JSON.stringify(payload),
      signal
    });
    if (!response.ok) {
      const errorPayload = await response.json().catch(() => null);
      throw new OpenUIError(
        errorPayload?.error?.message ||
          errorPayload?.detail ||
          `Request failed (${response.status})`,
        response.status,
        errorPayload
      );
    }
    for await (const event of parseEventStream(response.body)) {
      if (Array.isArray(event.openui?.sources)) onSources?.(event.openui.sources);
      if (Array.isArray(event.openui?.toolEvents)) {
        onTools?.(event.openui.toolEvents);
      }
      const content = event.choices?.[0]?.delta?.content;
      if (content) yield content;
    }
  }
}

export function createOpenUIClient(options) {
  return new OpenUIClient(options);
}
