import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const STORAGE_KEY = "openui-js-react-state-v1";
const THEME_KEY = "openui-js-theme";

const suggestions = [
  {
    number: "01",
    color: "amber",
    title: "하루 계획 세우기",
    description: "중요한 일부터 차근차근",
    prompt: "오늘 집중할 일을 우선순위별로 정리해줘"
  },
  {
    number: "02",
    color: "green",
    title: "아이디어 탐색하기",
    description: "다음 프로젝트의 시작점",
    prompt: "React로 작은 사이드 프로젝트 아이디어 5개를 제안해줘"
  },
  {
    number: "03",
    color: "blue",
    title: "글 다듬기",
    description: "더 선명하고 자연스럽게",
    prompt: "아래 내용을 더 명확하고 자연스럽게 다듬어줘:\n\n"
  }
];

function makeId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createChat(model = "llama3.2") {
  const now = Date.now();
  return {
    id: makeId(),
    title: "새 대화",
    model,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
}

function normalizeChat(chat, fallbackModel = "llama3.2") {
  return {
    ...chat,
    title: chat.title || "새 대화",
    model: chat.model || fallbackModel,
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || chat.createdAt || Date.now(),
    messages: Array.isArray(chat.messages) ? chat.messages : []
  };
}

function loadSavedState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    return {
      chats: Array.isArray(saved.chats) ? saved.chats : [],
      activeChatId: saved.activeChatId || null,
      selectedModel: saved.selectedModel || ""
    };
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return { chats: [], activeChatId: null, selectedModel: "" };
  }
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ko", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

async function readEventStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const event = JSON.parse(data);
        const content = event.choices?.[0]?.delta?.content;
        if (content) onDelta(content);
      } catch {
        // Providers can send keep-alive and non-JSON metadata events.
      }
    }
    if (done) break;
  }
}

function BrandMark({ hero = false }) {
  return (
    <span className={hero ? "hero-mark" : "brand-mark"} aria-hidden="true">
      <i />
      <i />
    </span>
  );
}

function Message({ message, streaming }) {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1200);
  };

  return (
    <article className={`message ${message.role}`}>
      <div className="avatar" aria-hidden="true" />
      <div className="message-content">
        <div className="message-meta">
          <strong>{message.role === "user" ? "나" : "OpenUI JS"}</strong>
          <span>{formatTime(message.createdAt)}</span>
        </div>
        <div className={`message-body${streaming ? " typing" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
        <div className="message-actions">
          <button className="copy-button" type="button" onClick={copy}>
            {copied ? "복사됨" : "복사"}
          </button>
        </div>
      </div>
    </article>
  );
}

function AuthModal({
  mode,
  loading,
  error,
  registrationAllowed,
  onClose,
  onModeChange,
  onSubmit
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const register = mode === "register";

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="auth-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="auth-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="modal-close" type="button" aria-label="닫기" onClick={onClose}>
          ×
        </button>
        <BrandMark hero />
        <p className="eyebrow">PRIVATE SYNC</p>
        <h2 id="auth-title">{register ? "계정 만들기" : "다시 만나서 반가워요"}</h2>
        <p className="auth-copy">
          {register
            ? "대화를 SQLite에 안전하게 저장하고 기기 사이에서 이어가세요."
            : "로그인하면 서버에 저장된 대화를 불러옵니다."}
        </p>
        <form
          className="auth-form"
          onSubmit={(event) => {
            event.preventDefault();
            onSubmit({ email, password });
          }}
        >
          <label>
            이메일
            <input
              type="email"
              autoComplete="email"
              value={email}
              required
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            비밀번호
            <input
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              minLength="8"
              maxLength="128"
              value={password}
              required
              onChange={(event) => setPassword(event.target.value)}
              placeholder="8자 이상"
            />
          </label>
          {error ? <p className="auth-error">{error}</p> : null}
          <button className="auth-submit" type="submit" disabled={loading}>
            {loading ? "처리 중…" : register ? "가입하고 동기화" : "로그인"}
          </button>
        </form>
        {register || registrationAllowed ? (
          <button
            className="auth-switch"
            type="button"
            onClick={() => onModeChange(register ? "login" : "register")}
          >
            {register ? "이미 계정이 있나요? 로그인" : "처음인가요? 계정 만들기"}
          </button>
        ) : null}
      </section>
    </div>
  );
}

export default function App() {
  const saved = useMemo(loadSavedState, []);
  const [chats, setChats] = useState(saved.chats);
  const [activeChatId, setActiveChatId] = useState(
    saved.activeChatId || saved.chats[0]?.id || null
  );
  const [selectedModel, setSelectedModel] = useState(saved.selectedModel);
  const [defaultModel, setDefaultModel] = useState("llama3.2");
  const [models, setModels] = useState([]);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [input, setInput] = useState("");
  const [generating, setGenerating] = useState(false);
  const [user, setUser] = useState(undefined);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState("login");
  const [authLoading, setAuthLoading] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authRequired, setAuthRequired] = useState(true);
  const [registrationAllowed, setRegistrationAllowed] = useState(true);
  const [syncStatus, setSyncStatus] = useState("로컬 저장");
  const [connection, setConnection] = useState({
    status: "loading",
    title: "연결 확인 중",
    detail: "모델 서버를 찾고 있어요"
  });
  const [theme, setTheme] = useState(
    () =>
      localStorage.getItem(THEME_KEY) ||
      (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
  );
  const abortRef = useRef(null);
  const conversationRef = useRef(null);
  const textareaRef = useRef(null);
  const modelPickerRef = useRef(null);
  const syncTimerRef = useRef(null);

  const activeChat = useMemo(
    () => chats.find((chat) => chat.id === activeChatId),
    [chats, activeChatId]
  );

  useEffect(() => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        chats: user ? [] : chats,
        activeChatId: user ? null : activeChatId,
        selectedModel
      })
    );
  }, [chats, activeChatId, selectedModel, user]);

  useEffect(() => {
    async function restoreSession() {
      try {
        const response = await fetch("/api/auth/me");
        if (!response.ok) {
          setUser(null);
          return;
        }
        const payload = await response.json();
        setUser(payload.user);
        setSyncStatus("동기화 중");
        try {
          const sync = await fetch("/api/chats/sync", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              chats: saved.chats.map((chat) => normalizeChat(chat, saved.selectedModel))
            })
          });
          if (!sync.ok) throw new Error();
          const synced = await sync.json();
          setChats(synced.chats);
          setActiveChatId((current) =>
            synced.chats.some((chat) => chat.id === current)
              ? current
              : synced.chats[0]?.id || null
          );
          setSyncStatus("서버 동기화됨");
        } catch {
          setSyncStatus("동기화 오류");
        }
      } catch {
        setUser(null);
        setSyncStatus("로컬 저장");
      }
    }
    restoreSession();
  }, []);

  useEffect(() => {
    if (!user) return;
    window.clearTimeout(syncTimerRef.current);
    setSyncStatus("저장 중…");
    syncTimerRef.current = window.setTimeout(async () => {
      try {
        const response = await fetch("/api/chats/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chats: chats.map((chat) => normalizeChat(chat, selectedModel || defaultModel))
          })
        });
        if (!response.ok) throw new Error();
        setSyncStatus("서버 동기화됨");
      } catch {
        setSyncStatus("동기화 오류");
      }
    }, 600);
    return () => window.clearTimeout(syncTimerRef.current);
  }, [chats, user, selectedModel, defaultModel]);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem(THEME_KEY, theme);
    document.querySelector('meta[name="theme-color"]').content =
      theme === "dark" ? "#171a18" : "#f4f1eb";
  }, [theme]);

  useEffect(() => {
    const element = conversationRef.current;
    if (element) element.scrollTop = element.scrollHeight;
  }, [activeChat?.messages]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 180)}px`;
  }, [input]);

  useEffect(() => {
    async function loadModels() {
      try {
        const config = await (await fetch("/api/config")).json();
        setDefaultModel(config.defaultModel);
        setAuthRequired(config.authRequired !== false);
        setRegistrationAllowed(config.registrationAllowed !== false);
        const host = new URL(config.apiBaseUrl).host;
        if (config.authRequired !== false && !user) {
          setSelectedModel((current) => current || config.defaultModel);
          setConnection({
            status: "offline",
            title: "로그인 필요",
            detail: "모델을 사용하려면 로그인하세요"
          });
          return;
        }
        const response = await fetch("/api/models");
        if (!response.ok) throw new Error("모델 목록을 불러오지 못했습니다");
        const payload = await response.json();
        const nextModels = Array.isArray(payload.data)
          ? payload.data.map((model) => model.id).filter(Boolean).sort()
          : [];
        setModels(nextModels);
        setSelectedModel((current) => {
          if (current && nextModels.includes(current)) return current;
          if (nextModels.includes(config.defaultModel)) return config.defaultModel;
          return nextModels[0] || config.defaultModel;
        });
        setConnection({ status: "online", title: "모델 서버 연결됨", detail: host });
      } catch (error) {
        setSelectedModel((current) => current || defaultModel);
        setConnection({ status: "offline", title: "연결 필요", detail: error.message });
      }
    }
    loadModels();
  }, [user]);

  useEffect(() => {
    const handleClick = (event) => {
      if (!modelPickerRef.current?.contains(event.target)) setModelMenuOpen(false);
    };
    const handleKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        startNewChat();
      }
      if (event.key === "Escape") {
        setModelMenuOpen(false);
        setSidebarOpen(false);
        setAuthOpen(false);
      }
    };
    document.addEventListener("click", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("click", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  });

  const updateChat = useCallback((chatId, updater) => {
    setChats((current) =>
      current.map((chat) =>
        chat.id === chatId
          ? { ...updater(chat), updatedAt: Date.now() }
          : chat
      )
    );
  }, []);

  function startNewChat() {
    if (authRequired && !user) {
      setAuthOpen(true);
      return null;
    }
    const chat = createChat(selectedModel || defaultModel);
    setChats((current) => [chat, ...current]);
    setActiveChatId(chat.id);
    setSidebarOpen(false);
    requestAnimationFrame(() => textareaRef.current?.focus());
    return chat;
  }

  function deleteChat(chatId) {
    if (generating && chatId === activeChatId) abortRef.current?.abort();
    const nextChats = chats.filter((chat) => chat.id !== chatId);
    setChats(nextChats);
    if (activeChatId === chatId) setActiveChatId(nextChats[0]?.id || null);
    if (user) {
      fetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }).catch(
        () => setSyncStatus("동기화 오류")
      );
    }
  }

  function clearChat() {
    if (!activeChat?.messages.length) return;
    abortRef.current?.abort();
    updateChat(activeChat.id, (chat) => ({ ...chat, title: "새 대화", messages: [] }));
  }

  async function authenticate(credentials) {
    setAuthLoading(true);
    setAuthError("");
    try {
      const response = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(credentials)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(payload.detail || "인증 요청을 처리하지 못했습니다.");
      }
      setUser(payload.user);
      setSyncStatus("동기화 중");
      try {
        const sync = await fetch("/api/chats/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chats: chats.map((chat) => normalizeChat(chat, selectedModel || defaultModel))
          })
        });
        if (!sync.ok) throw new Error();
        const synced = await sync.json();
        setChats(synced.chats);
        setActiveChatId((current) =>
          synced.chats.some((chat) => chat.id === current)
            ? current
            : synced.chats[0]?.id || null
        );
        setSyncStatus("서버 동기화됨");
      } catch {
        setSyncStatus("동기화 오류");
      }
      setAuthOpen(false);
    } catch (error) {
      setAuthError(error.message);
    } finally {
      setAuthLoading(false);
    }
  }

  async function logout() {
    abortRef.current?.abort();
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
    setUser(null);
    setChats([]);
    setActiveChatId(null);
    setSyncStatus("로컬 저장");
  }

  async function submitMessage(event) {
    event?.preventDefault();
    if (authRequired && !user) {
      setAuthOpen(true);
      return;
    }
    const content = input.trim();
    if (!content || generating) return;

    let chat = activeChat;
    if (!chat) {
      chat = createChat(selectedModel || defaultModel);
      setChats((current) => [chat, ...current]);
      setActiveChatId(chat.id);
    }

    const userMessage = {
      id: makeId(),
      role: "user",
      content,
      createdAt: Date.now()
    };
    const assistantMessage = {
      id: makeId(),
      role: "assistant",
      content: "",
      createdAt: Date.now()
    };
    const requestMessages = [...chat.messages, userMessage];
    const nextMessages = [...requestMessages, assistantMessage];
    const title =
      chat.messages.length === 0
        ? content.replace(/\s+/g, " ").slice(0, 34)
        : chat.title;

    updateChat(chat.id, (current) => ({
      ...current,
      title,
      model: selectedModel || defaultModel,
      messages: nextMessages
    }));
    setInput("");
    setGenerating(true);
    abortRef.current = new AbortController();

    try {
      const response = await fetch("/api/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: selectedModel || defaultModel,
          messages: requestMessages.map(({ role, content: text }) => ({
            role,
            content: text
          })),
          temperature: 0.7
        }),
        signal: abortRef.current.signal
      });

      if (!response.ok) {
        let message = `요청 실패 (${response.status})`;
        try {
          const payload = await response.json();
          message = payload.error?.message || message;
        } catch {
          // Keep status fallback.
        }
        throw new Error(message);
      }

      let fullContent = "";
      await readEventStream(response, (delta) => {
        fullContent += delta;
        updateChat(chat.id, (current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: fullContent }
              : message
          )
        }));
      });

      if (!fullContent) {
        updateChat(chat.id, (current) => ({
          ...current,
          messages: current.messages.map((message) =>
            message.id === assistantMessage.id
              ? { ...message, content: "응답이 비어 있습니다." }
              : message
          )
        }));
      }
    } catch (error) {
      const errorMessage =
        error.name === "AbortError"
          ? "응답 생성을 중단했습니다."
          : `연결 오류: ${error.message}`;
      updateChat(chat.id, (current) => ({
        ...current,
        messages: current.messages.map((message) =>
          message.id === assistantMessage.id
            ? { ...message, content: errorMessage }
            : message
        )
      }));
    } finally {
      abortRef.current = null;
      setGenerating(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  }

  return (
    <div className="app-shell">
      <aside className={`sidebar${sidebarOpen ? " open" : ""}`} aria-label="채팅 목록">
        <div className="brand-row">
          <a className="brand" href="/" aria-label="OpenUI JS 홈">
            <BrandMark />
            <span>
              OpenUI <b>JS</b>
            </span>
          </a>
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label="사이드바 닫기"
            onClick={() => setSidebarOpen(false)}
          >
            ×
          </button>
        </div>

        <button className="new-chat-button" type="button" onClick={startNewChat}>
          <span aria-hidden="true">＋</span>
          새 대화
          <kbd>⌘ K</kbd>
        </button>

        <div className="history-heading">
          <span>최근 대화</span>
          <span>{chats.length}</span>
        </div>
        <nav className="chat-list" aria-label="최근 대화">
          {chats.map((chat) => (
            <button
              className={`chat-item${chat.id === activeChatId ? " active" : ""}`}
              type="button"
              key={chat.id}
              onClick={() => {
                setActiveChatId(chat.id);
                setSidebarOpen(false);
              }}
            >
              <span className="chat-title">{chat.title}</span>
              <span
                className="delete-chat"
                role="button"
                tabIndex="0"
                aria-label="대화 삭제"
                title="삭제"
                onClick={(event) => {
                  event.stopPropagation();
                  deleteChat(chat.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.stopPropagation();
                    deleteChat(chat.id);
                  }
                }}
              >
                ×
              </span>
            </button>
          ))}
        </nav>

        <div className="sidebar-footer">
          {user ? (
            <div className="account-card">
              <span className="account-avatar" aria-hidden="true">
                {user.email.slice(0, 1).toUpperCase()}
              </span>
              <div>
                <strong>{user.email}</strong>
                <span>{syncStatus}</span>
              </div>
              <button type="button" onClick={logout}>
                로그아웃
              </button>
            </div>
          ) : (
            <button
              className="account-login"
              type="button"
              disabled={user === undefined}
              onClick={() => {
                setAuthError("");
                setAuthMode("login");
                setAuthOpen(true);
              }}
            >
              <span className="account-avatar" aria-hidden="true">↗</span>
              <span>
                <strong>{user === undefined ? "계정 확인 중" : "로그인"}</strong>
                <small>대화를 서버에 동기화</small>
              </span>
            </button>
          )}
          <div className="connection-card">
            <span className={`status-dot ${connection.status}`} aria-hidden="true" />
            <div>
              <strong>{connection.title}</strong>
              <span>{connection.detail}</span>
            </div>
          </div>
          <button
            className="theme-button"
            type="button"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <span aria-hidden="true">{theme === "dark" ? "☾" : "☼"}</span>
            <span>{theme === "dark" ? "다크 모드" : "라이트 모드"}</span>
          </button>
        </div>
      </aside>

      <div
        className={`sidebar-backdrop${sidebarOpen ? " open" : ""}`}
        onClick={() => setSidebarOpen(false)}
      />

      <main className="main-panel">
        <header className="topbar">
          <button
            className="icon-button mobile-only"
            type="button"
            aria-label="사이드바 열기"
            onClick={() => setSidebarOpen(true)}
          >
            ☰
          </button>
          <div ref={modelPickerRef}>
            <button
              className="model-picker"
              type="button"
              aria-haspopup="listbox"
              aria-expanded={modelMenuOpen}
              onClick={() => setModelMenuOpen((open) => !open)}
            >
              <span>
                <small>사용 모델</small>
                <strong>{selectedModel || "모델 불러오는 중"}</strong>
              </span>
              <span className="chevron" aria-hidden="true">
                ⌄
              </span>
            </button>
            <div
              className={`model-menu${modelMenuOpen ? " open" : ""}`}
              role="listbox"
              aria-label="모델 선택"
            >
              {(models.length ? models : [defaultModel]).map((model) => (
                <button
                  className={`model-option${model === selectedModel ? " selected" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={model === selectedModel}
                  key={model}
                  onClick={() => {
                    setSelectedModel(model);
                    setModelMenuOpen(false);
                  }}
                >
                  {model}
                </button>
              ))}
            </div>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button"
              type="button"
              aria-label="현재 대화 비우기"
              title="대화 비우기"
              onClick={clearChat}
            >
              ⌫
            </button>
          </div>
        </header>

        <section className="conversation" ref={conversationRef} aria-live="polite">
          {!activeChat?.messages.length ? (
            <div className="empty-state">
              <div className="hero-orbit" aria-hidden="true">
                <span className="orbit-ring" />
                <BrandMark hero />
              </div>
              <p className="eyebrow">REACT FRONTEND · FASTAPI BACKEND</p>
              <h1>
                무엇을 같이
                <br />
                <em>만들어볼까요?</em>
              </h1>
              <p className="hero-copy">
                Ollama 또는 OpenAI 호환 모델과 대화하세요.
                <br />
                {user
                  ? "대화는 내 계정의 SQLite 저장소에 동기화됩니다."
                  : "로그인 전 기록은 이 브라우저에 보관됩니다."}
              </p>
              <div className="suggestion-grid">
                {suggestions.map((suggestion) => (
                  <button
                    className="suggestion"
                    type="button"
                    key={suggestion.number}
                    onClick={() => {
                      if (authRequired && !user) {
                        setAuthOpen(true);
                        return;
                      }
                      setInput(suggestion.prompt);
                      requestAnimationFrame(() => textareaRef.current?.focus());
                    }}
                  >
                    <span className={`suggestion-icon ${suggestion.color}`}>
                      {suggestion.number}
                    </span>
                    <span>
                      <strong>{suggestion.title}</strong>
                      <small>{suggestion.description}</small>
                    </span>
                    <b aria-hidden="true">↗</b>
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="message-list">
              {activeChat.messages.map((message, index) => (
                <Message
                  message={message}
                  key={message.id}
                  streaming={
                    generating &&
                    index === activeChat.messages.length - 1 &&
                    message.role === "assistant"
                  }
                />
              ))}
            </div>
          )}
        </section>

        <footer className="composer-wrap">
          <form className="composer" onSubmit={submitMessage}>
            <textarea
              ref={textareaRef}
              rows="1"
              maxLength="32000"
              placeholder={
                authRequired && !user
                  ? "로그인 후 메시지를 보낼 수 있어요"
                  : "메시지를 입력하세요"
              }
              aria-label="메시지"
              value={input}
              disabled={generating || (authRequired && !user)}
              onChange={(event) => setInput(event.target.value)}
              onKeyDown={(event) => {
                if (
                  event.key === "Enter" &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  submitMessage();
                }
              }}
            />
            <div className="composer-bottom">
              <span className="composer-hint">
                <kbd>Enter</kbd> 전송 · <kbd>Shift Enter</kbd> 줄바꿈
              </span>
              <button
                className="send-button"
                type="submit"
                aria-label="메시지 보내기"
                disabled={generating || !input.trim() || (authRequired && !user)}
              >
                ↑
              </button>
            </div>
          </form>
          <p className="disclaimer">
            AI는 실수할 수 있습니다. 중요한 정보는 한 번 더 확인하세요.
          </p>
        </footer>
      </main>
      {authOpen ? (
        <AuthModal
          mode={authMode}
          loading={authLoading}
          error={authError}
          registrationAllowed={registrationAllowed}
          onClose={() => setAuthOpen(false)}
          onModeChange={(mode) => {
            setAuthMode(mode);
            setAuthError("");
          }}
          onSubmit={authenticate}
        />
      ) : null}
    </div>
  );
}
