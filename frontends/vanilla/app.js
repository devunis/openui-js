import "../shared/styles.css";

const STORAGE_KEY = "openui-js-vanilla-state-v1";
const THEME_KEY = "openui-js-theme";
const $ = (selector) => document.querySelector(selector);
const elements = {
  accountArea: $("#accountArea"),
  authClose: $("#authClose"),
  authCopy: $("#authCopy"),
  authEmail: $("#authEmail"),
  authError: $("#authError"),
  authForm: $("#authForm"),
  authModal: $("#authModal"),
  authPassword: $("#authPassword"),
  authSubmit: $("#authSubmit"),
  authSwitch: $("#authSwitch"),
  authTitle: $("#authTitle"),
  backdrop: $("#backdrop"),
  chatCount: $("#chatCount"),
  chatList: $("#chatList"),
  clearChat: $("#clearChat"),
  closeSidebar: $("#closeSidebar"),
  composer: $("#composer"),
  connectionDetail: $("#connectionDetail"),
  connectionTitle: $("#connectionTitle"),
  conversation: $("#conversation"),
  emptyState: $("#emptyState"),
  input: $("#messageInput"),
  messageList: $("#messageList"),
  messageTemplate: $("#messageTemplate"),
  modelMenu: $("#modelMenu"),
  modelPicker: $("#modelPicker"),
  modelPickerWrap: $("#modelPickerWrap"),
  newChat: $("#newChat"),
  openSidebar: $("#openSidebar"),
  selectedModel: $("#selectedModel"),
  sendButton: $("#sendButton"),
  sidebar: $("#sidebar"),
  statusDot: $("#statusDot"),
  storageMessage: $("#storageMessage"),
  themeButton: $("#themeButton"),
  themeIcon: $("#themeIcon"),
  themeLabel: $("#themeLabel")
};

const state = {
  chats: [],
  activeChatId: null,
  selectedModel: "",
  defaultModel: "llama3.2",
  models: [],
  generating: false,
  controller: null,
  user: undefined,
  authMode: "login",
  authRequired: true,
  registrationAllowed: true,
  syncStatus: "로컬 저장",
  syncTimer: null
};

const makeId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

function load() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    state.chats = Array.isArray(saved.chats) ? saved.chats : [];
    state.activeChatId = saved.activeChatId || state.chats[0]?.id || null;
    state.selectedModel = saved.selectedModel || "";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function save() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      chats: state.user ? [] : state.chats,
      activeChatId: state.user ? null : state.activeChatId,
      selectedModel: state.selectedModel
    })
  );
}

function activeChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId);
}

function normalizeChat(chat) {
  return {
    ...chat,
    title: chat.title || "새 대화",
    model: chat.model || state.selectedModel || state.defaultModel,
    createdAt: chat.createdAt || Date.now(),
    updatedAt: chat.updatedAt || chat.createdAt || Date.now(),
    messages: Array.isArray(chat.messages) ? chat.messages : []
  };
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function markdown(source) {
  const blocks = [];
  let safe = escapeHtml(source).replace(/```([\w-]*)\n?([\s\S]*?)```/g, (_, language, code) => {
    const index = blocks.push(
      `<pre data-language="${language || "text"}"><code>${code.replace(/\n$/, "")}</code></pre>`
    );
    return `\n%%CODE${index - 1}%%\n`;
  });
  safe = safe
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*]+)\*/g, "<em>$1</em>")
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>'
    );

  return safe
    .split("\n")
    .map((line) => {
      const code = line.match(/^%%CODE(\d+)%%$/);
      if (code) return blocks[Number(code[1])];
      const heading = line.match(/^(#{1,3})\s+(.+)$/);
      if (heading) return `<h${heading[1].length}>${heading[2]}</h${heading[1].length}>`;
      if (/^[-*]\s+/.test(line)) return `<p>• ${line.replace(/^[-*]\s+/, "")}</p>`;
      if (/^&gt;\s?/.test(line)) {
        return `<blockquote>${line.replace(/^&gt;\s?/, "")}</blockquote>`;
      }
      return line.trim() ? `<p>${line}</p>` : "";
    })
    .join("");
}

function formatTime(timestamp) {
  return new Intl.DateTimeFormat("ko", {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function renderMessage(message, streaming = false) {
  const fragment = elements.messageTemplate.content.cloneNode(true);
  const article = fragment.querySelector(".message");
  const body = fragment.querySelector(".message-body");
  const copy = fragment.querySelector(".copy-button");
  article.classList.add(message.role);
  fragment.querySelector(".message-meta strong").textContent =
    message.role === "user" ? "나" : "OpenUI JS";
  fragment.querySelector(".message-meta span").textContent = formatTime(message.createdAt);
  body.innerHTML = markdown(message.content);
  body.classList.toggle("typing", streaming);
  copy.addEventListener("click", async () => {
    await navigator.clipboard.writeText(message.content);
    copy.textContent = "복사됨";
    setTimeout(() => (copy.textContent = "복사"), 1200);
  });
  elements.messageList.append(fragment);
}

function renderMessages() {
  const messages = activeChat()?.messages || [];
  elements.emptyState.hidden = messages.length > 0;
  elements.messageList.replaceChildren();
  messages.forEach((message, index) =>
    renderMessage(
      message,
      state.generating && index === messages.length - 1 && message.role === "assistant"
    )
  );
  requestAnimationFrame(() => {
    elements.conversation.scrollTop = elements.conversation.scrollHeight;
  });
}

function renderChats() {
  elements.chatList.replaceChildren();
  elements.chatCount.textContent = state.chats.length;
  for (const chat of state.chats) {
    const button = document.createElement("button");
    button.className = `chat-item${chat.id === state.activeChatId ? " active" : ""}`;
    button.type = "button";
    button.innerHTML =
      '<span class="chat-title"></span><span class="delete-chat" role="button" aria-label="대화 삭제">×</span>';
    button.querySelector(".chat-title").textContent = chat.title;
    button.addEventListener("click", () => {
      state.activeChatId = chat.id;
      save();
      render();
      closeSidebar();
    });
    button.querySelector(".delete-chat").addEventListener("click", (event) => {
      event.stopPropagation();
      deleteChat(chat.id);
    });
    elements.chatList.append(button);
  }
}

function renderAccount() {
  elements.accountArea.replaceChildren();
  if (state.user) {
    const card = document.createElement("div");
    card.className = "account-card";
    card.innerHTML =
      '<span class="account-avatar" aria-hidden="true"></span><div><strong></strong><span></span></div><button type="button">로그아웃</button>';
    card.querySelector(".account-avatar").textContent = state.user.email
      .slice(0, 1)
      .toUpperCase();
    card.querySelector("strong").textContent = state.user.email;
    card.querySelector("div span").textContent = state.syncStatus;
    card.querySelector("button").addEventListener("click", logout);
    elements.accountArea.append(card);
    elements.storageMessage.textContent =
      "대화는 내 계정의 SQLite 저장소에 동기화됩니다.";
    return;
  }

  const button = document.createElement("button");
  button.className = "account-login";
  button.type = "button";
  button.disabled = state.user === undefined;
  button.innerHTML =
    '<span class="account-avatar" aria-hidden="true">↗</span><span><strong></strong><small>대화를 서버에 동기화</small></span>';
  button.querySelector("strong").textContent =
    state.user === undefined ? "계정 확인 중" : "로그인";
  button.addEventListener("click", openAuth);
  elements.accountArea.append(button);
  elements.storageMessage.textContent = "로그인 전 기록은 이 브라우저에 보관됩니다.";
}

function updateAccess() {
  const blocked = state.authRequired && !state.user;
  elements.input.disabled = state.generating || blocked;
  elements.sendButton.disabled = state.generating || blocked;
  elements.input.placeholder = blocked
    ? "로그인 후 메시지를 보낼 수 있어요"
    : "메시지를 입력하세요";
}

function render() {
  renderChats();
  renderMessages();
  renderAccount();
  updateAccess();
}

function newChat() {
  if (state.authRequired && !state.user) {
    openAuth();
    return null;
  }
  const now = Date.now();
  const chat = {
    id: makeId(),
    title: "새 대화",
    model: state.selectedModel || state.defaultModel,
    createdAt: now,
    updatedAt: now,
    messages: []
  };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  save();
  render();
  scheduleSync();
  closeSidebar();
  elements.input.focus();
  return chat;
}

function deleteChat(chatId) {
  if (state.generating && chatId === state.activeChatId) state.controller?.abort();
  state.chats = state.chats.filter((chat) => chat.id !== chatId);
  if (state.activeChatId === chatId) state.activeChatId = state.chats[0]?.id || null;
  save();
  render();
  if (state.user) {
    fetch(`/api/chats/${encodeURIComponent(chatId)}`, { method: "DELETE" }).catch(() => {
      state.syncStatus = "동기화 오류";
      renderAccount();
    });
  }
}

function setGenerating(value) {
  state.generating = value;
  updateAccess();
}

function scheduleSync() {
  if (!state.user) return;
  clearTimeout(state.syncTimer);
  state.syncStatus = "저장 중…";
  renderAccount();
  state.syncTimer = setTimeout(async () => {
    try {
      const response = await fetch("/api/chats/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chats: state.chats.map(normalizeChat) })
      });
      if (!response.ok) throw new Error();
      state.syncStatus = "서버 동기화됨";
    } catch {
      state.syncStatus = "동기화 오류";
    }
    renderAccount();
  }, 600);
}

function setAuthMode(mode) {
  if (mode === "register" && !state.registrationAllowed) return;
  state.authMode = mode;
  const register = mode === "register";
  elements.authTitle.textContent = register ? "계정 만들기" : "다시 만나서 반가워요";
  elements.authCopy.textContent = register
    ? "대화를 SQLite에 안전하게 저장하고 기기 사이에서 이어가세요."
    : "로그인하면 서버에 저장된 대화를 불러옵니다.";
  elements.authPassword.autocomplete = register ? "new-password" : "current-password";
  elements.authSubmit.textContent = register ? "가입하고 동기화" : "로그인";
  elements.authSwitch.textContent = register
    ? "이미 계정이 있나요? 로그인"
    : "처음인가요? 계정 만들기";
  elements.authSwitch.hidden = !register && !state.registrationAllowed;
  elements.authError.hidden = true;
}

function openAuth() {
  setAuthMode("login");
  elements.authModal.hidden = false;
  requestAnimationFrame(() => elements.authEmail.focus());
}

function closeAuth() {
  elements.authModal.hidden = true;
  elements.authError.hidden = true;
}

async function authenticate() {
  elements.authSubmit.disabled = true;
  elements.authSubmit.textContent = "처리 중…";
  elements.authError.hidden = true;
  try {
    const response = await fetch(`/api/auth/${state.authMode}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: elements.authEmail.value,
        password: elements.authPassword.value
      })
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload.detail || "인증 요청을 처리하지 못했습니다.");
    }
    state.user = payload.user;
    state.syncStatus = "동기화 중";
    try {
      const sync = await fetch("/api/chats/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chats: state.chats.map(normalizeChat) })
      });
      if (!sync.ok) throw new Error();
      const synced = await sync.json();
      state.chats = synced.chats;
      if (!state.chats.some((chat) => chat.id === state.activeChatId)) {
        state.activeChatId = state.chats[0]?.id || null;
      }
      state.syncStatus = "서버 동기화됨";
    } catch {
      state.syncStatus = "동기화 오류";
    }
    elements.authPassword.value = "";
    closeAuth();
    save();
    render();
    loadModels();
  } catch (error) {
    elements.authError.textContent = error.message;
    elements.authError.hidden = false;
  } finally {
    elements.authSubmit.disabled = false;
    elements.authSubmit.textContent =
      state.authMode === "register" ? "가입하고 동기화" : "로그인";
  }
}

async function logout() {
  state.controller?.abort();
  await fetch("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  state.chats = [];
  state.activeChatId = null;
  state.syncStatus = "로컬 저장";
  save();
  render();
  loadModels();
}

async function restoreSession() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) {
      state.user = null;
      renderAccount();
      return;
    }
    const payload = await response.json();
    state.user = payload.user;
    state.syncStatus = "동기화 중";
    renderAccount();
    try {
      const sync = await fetch("/api/chats/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chats: state.chats.map(normalizeChat) })
      });
      if (!sync.ok) throw new Error();
      const synced = await sync.json();
      state.chats = synced.chats;
      if (!state.chats.some((chat) => chat.id === state.activeChatId)) {
        state.activeChatId = state.chats[0]?.id || null;
      }
      state.syncStatus = "서버 동기화됨";
    } catch {
      state.syncStatus = "동기화 오류";
    }
    save();
    render();
    loadModels();
  } catch {
    state.user = null;
    state.syncStatus = "로컬 저장";
    renderAccount();
  }
}

async function readStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) {
      if (!line.trim().startsWith("data:")) continue;
      const data = line.trim().slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        const delta = JSON.parse(data).choices?.[0]?.delta?.content;
        if (delta) onDelta(delta);
      } catch {
        // Ignore provider-specific events.
      }
    }
    if (done) break;
  }
}

async function sendMessage(content) {
  if (state.authRequired && !state.user) {
    openAuth();
    return;
  }
  if (!content.trim() || state.generating) return;
  const chat = activeChat() || newChat();
  const user = { id: makeId(), role: "user", content: content.trim(), createdAt: Date.now() };
  const assistant = { id: makeId(), role: "assistant", content: "", createdAt: Date.now() };
  const requestMessages = [...chat.messages, user];
  chat.messages.push(user, assistant);
  chat.model = state.selectedModel || state.defaultModel;
  chat.updatedAt = Date.now();
  if (chat.messages.length === 2) {
    chat.title = content.trim().replace(/\s+/g, " ").slice(0, 34);
  }
  save();
  setGenerating(true);
  render();
  state.controller = new AbortController();

  try {
    const response = await fetch("/api/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: state.selectedModel || state.defaultModel,
        messages: requestMessages.map(({ role, content: text }) => ({ role, content: text })),
        temperature: 0.7
      }),
      signal: state.controller.signal
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error?.message || `요청 실패 (${response.status})`);
    }
    await readStream(response, (delta) => {
      assistant.content += delta;
      renderMessages();
    });
    if (!assistant.content) assistant.content = "응답이 비어 있습니다.";
  } catch (error) {
    assistant.content =
      error.name === "AbortError" ? "응답 생성을 중단했습니다." : `연결 오류: ${error.message}`;
  } finally {
    state.controller = null;
    setGenerating(false);
    save();
    render();
    scheduleSync();
    elements.input.focus();
  }
}

function renderModels() {
  elements.modelMenu.replaceChildren();
  const models = state.models.length ? state.models : [state.defaultModel];
  for (const model of models) {
    const option = document.createElement("button");
    option.type = "button";
    option.className = `model-option${model === state.selectedModel ? " selected" : ""}`;
    option.textContent = model;
    option.addEventListener("click", () => {
      state.selectedModel = model;
      const chat = activeChat();
      if (chat) {
        chat.model = model;
        chat.updatedAt = Date.now();
      }
      elements.selectedModel.textContent = model;
      save();
      renderModels();
      scheduleSync();
      elements.modelMenu.classList.remove("open");
    });
    elements.modelMenu.append(option);
  }
}

async function loadModels() {
  try {
    const config = await (await fetch("/api/config")).json();
    state.defaultModel = config.defaultModel;
    state.authRequired = config.authRequired !== false;
    state.registrationAllowed = config.registrationAllowed !== false;
    elements.connectionDetail.textContent = new URL(config.apiBaseUrl).host;
    if (state.authRequired && !state.user) {
      state.selectedModel ||= state.defaultModel;
      elements.selectedModel.textContent = state.selectedModel;
      elements.connectionTitle.textContent = "로그인 필요";
      elements.connectionDetail.textContent = "모델을 사용하려면 로그인하세요";
      elements.statusDot.className = "status-dot offline";
      renderModels();
      renderAccount();
      updateAccess();
      return;
    }
    const response = await fetch("/api/models");
    if (!response.ok) throw new Error("모델 목록을 불러오지 못했습니다");
    const payload = await response.json();
    state.models = Array.isArray(payload.data)
      ? payload.data.map((model) => model.id).filter(Boolean).sort()
      : [];
    state.selectedModel =
      (state.models.includes(state.selectedModel) && state.selectedModel) ||
      (state.models.includes(state.defaultModel) && state.defaultModel) ||
      state.models[0] ||
      state.defaultModel;
    elements.connectionTitle.textContent = "모델 서버 연결됨";
    elements.statusDot.className = "status-dot online";
  } catch (error) {
    state.selectedModel ||= state.defaultModel;
    elements.connectionTitle.textContent = "연결 필요";
    elements.connectionDetail.textContent = error.message;
    elements.statusDot.className = "status-dot offline";
  }
  elements.selectedModel.textContent = state.selectedModel;
  renderModels();
  updateAccess();
  save();
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem(THEME_KEY, theme);
  const dark = theme === "dark";
  elements.themeIcon.textContent = dark ? "☾" : "☼";
  elements.themeLabel.textContent = dark ? "다크 모드" : "라이트 모드";
  $('meta[name="theme-color"]').content = dark ? "#171a18" : "#f4f1eb";
}

function closeSidebar() {
  elements.sidebar.classList.remove("open");
  elements.backdrop.classList.remove("open");
}

elements.composer.addEventListener("submit", (event) => {
  event.preventDefault();
  const content = elements.input.value;
  elements.input.value = "";
  elements.input.style.height = "auto";
  sendMessage(content);
});
elements.input.addEventListener("input", () => {
  elements.input.style.height = "auto";
  elements.input.style.height = `${Math.min(elements.input.scrollHeight, 180)}px`;
});
elements.input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    elements.composer.requestSubmit();
  }
});
elements.newChat.addEventListener("click", newChat);
elements.clearChat.addEventListener("click", () => {
  const chat = activeChat();
  if (!chat?.messages.length) return;
  state.controller?.abort();
  chat.messages = [];
  chat.title = "새 대화";
  chat.updatedAt = Date.now();
  save();
  render();
  scheduleSync();
});
elements.modelPicker.addEventListener("click", () => elements.modelMenu.classList.toggle("open"));
elements.openSidebar.addEventListener("click", () => {
  elements.sidebar.classList.add("open");
  elements.backdrop.classList.add("open");
});
elements.closeSidebar.addEventListener("click", closeSidebar);
elements.backdrop.addEventListener("click", closeSidebar);
elements.themeButton.addEventListener("click", () =>
  setTheme(document.documentElement.dataset.theme === "dark" ? "light" : "dark")
);
elements.authForm.addEventListener("submit", (event) => {
  event.preventDefault();
  authenticate();
});
elements.authClose.addEventListener("click", closeAuth);
elements.authModal.addEventListener("mousedown", (event) => {
  if (event.target === elements.authModal) closeAuth();
});
elements.authSwitch.addEventListener("click", () =>
  setAuthMode(state.authMode === "register" ? "login" : "register")
);
document.addEventListener("click", (event) => {
  if (!elements.modelPickerWrap.contains(event.target)) elements.modelMenu.classList.remove("open");
});
document.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    newChat();
  }
  if (event.key === "Escape") {
    elements.modelMenu.classList.remove("open");
    closeSidebar();
    closeAuth();
  }
});
document.querySelectorAll(".suggestion").forEach((button) =>
  button.addEventListener("click", () => {
    if (state.authRequired && !state.user) {
      openAuth();
      return;
    }
    elements.input.value = button.dataset.prompt;
    elements.input.dispatchEvent(new Event("input"));
    elements.input.focus();
  })
);

load();
setTheme(
  localStorage.getItem(THEME_KEY) ||
    (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
);
render();
loadModels();
restoreSession();
