import "../shared/styles.css";

const STORAGE_KEY = "openui-js-vanilla-state-v1";
const THEME_KEY = "openui-js-theme";
const $ = (selector) => document.querySelector(selector);
const elements = {
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
  controller: null
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
      chats: state.chats,
      activeChatId: state.activeChatId,
      selectedModel: state.selectedModel
    })
  );
}

function activeChat() {
  return state.chats.find((chat) => chat.id === state.activeChatId);
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

function render() {
  renderChats();
  renderMessages();
}

function newChat() {
  const chat = { id: makeId(), title: "새 대화", createdAt: Date.now(), messages: [] };
  state.chats.unshift(chat);
  state.activeChatId = chat.id;
  save();
  render();
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
}

function setGenerating(value) {
  state.generating = value;
  elements.input.disabled = value;
  elements.sendButton.disabled = value;
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
  if (!content.trim() || state.generating) return;
  const chat = activeChat() || newChat();
  const user = { id: makeId(), role: "user", content: content.trim(), createdAt: Date.now() };
  const assistant = { id: makeId(), role: "assistant", content: "", createdAt: Date.now() };
  const requestMessages = [...chat.messages, user];
  chat.messages.push(user, assistant);
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
      elements.selectedModel.textContent = model;
      save();
      renderModels();
      elements.modelMenu.classList.remove("open");
    });
    elements.modelMenu.append(option);
  }
}

async function loadModels() {
  try {
    const config = await (await fetch("/api/config")).json();
    state.defaultModel = config.defaultModel;
    elements.connectionDetail.textContent = new URL(config.apiBaseUrl).host;
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
  save();
  render();
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
  }
});
document.querySelectorAll(".suggestion").forEach((button) =>
  button.addEventListener("click", () => {
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
