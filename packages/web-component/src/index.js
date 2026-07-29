import { OpenUIClient } from "../../core/src/index.js";

const styles = `
  :host {
    display: block;
    width: 100%;
    height: 100%;
    min-height: 420px;
    color: #20231f;
    font: 14px/1.55 Inter, ui-sans-serif, system-ui, sans-serif;
  }
  * { box-sizing: border-box; }
  .shell {
    display: grid;
    height: 100%;
    min-height: inherit;
    grid-template-rows: auto minmax(0, 1fr) auto;
    overflow: hidden;
    border: 1px solid #dedbd3;
    border-radius: 16px;
    background: #fbfaf7;
  }
  header {
    display: flex;
    align-items: center;
    gap: 9px;
    padding: 13px 15px;
    border-bottom: 1px solid #e5e1d9;
    font-weight: 800;
  }
  header i {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #ff6b3d;
  }
  .messages {
    min-height: 0;
    padding: 16px;
    overflow-y: auto;
  }
  .welcome { color: #74786f; text-align: center; margin: 20% 0; }
  article { max-width: 82%; margin: 0 0 14px; }
  article.user { margin-left: auto; }
  article b { display: block; margin-bottom: 4px; font-size: 11px; }
  article p {
    margin: 0;
    padding: 10px 12px;
    border-radius: 12px;
    background: #ece8e0;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  article.user p { background: #ff6b3d; color: white; }
  .sources { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .tools { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 7px; }
  .sources a {
    max-width: 180px;
    padding: 4px 7px;
    overflow: hidden;
    border: 1px solid #dedbd3;
    border-radius: 7px;
    color: inherit;
    font-size: 9px;
    text-overflow: ellipsis;
    text-decoration: none;
    white-space: nowrap;
  }
  .tools span {
    padding: 4px 7px;
    border: 1px solid #dedbd3;
    border-radius: 7px;
    color: #74786f;
    font-size: 9px;
  }
  form { display: flex; gap: 8px; padding: 12px; border-top: 1px solid #e5e1d9; }
  textarea {
    min-height: 42px;
    max-height: 120px;
    flex: 1;
    padding: 10px 11px;
    resize: vertical;
    border: 1px solid #dedbd3;
    border-radius: 11px;
    outline: none;
    background: white;
    color: inherit;
    font: inherit;
  }
  button {
    width: 42px;
    border: 0;
    border-radius: 11px;
    background: #20231f;
    color: white;
    cursor: pointer;
    font: inherit;
  }
  button:disabled { cursor: wait; opacity: .55; }
  @media (prefers-color-scheme: dark) {
    :host { color: #f1eee8; }
    .shell { border-color: #353a36; background: #1d201e; }
    header, form { border-color: #353a36; }
    article p { background: #303531; }
    textarea { border-color: #404640; background: #171a18; }
    button { background: #f1eee8; color: #171a18; }
    .sources a { border-color: #404640; }
    .tools span { border-color: #404640; color: #a4a79f; }
  }
`;

function messageId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

const HTMLElementBase = globalThis.HTMLElement || class {};

export class OpenUIChatElement extends HTMLElementBase {
  static get observedAttributes() {
    return ["base-url", "model", "provider-id", "placeholder", "welcome"];
  }

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.messages = [];
    this.generating = false;
    this.controller = null;
    this.client = null;
  }

  connectedCallback() {
    this.render();
    this.configure();
  }

  attributeChangedCallback() {
    if (this.isConnected) {
      this.render();
      this.configure();
    }
  }

  async configure() {
    this.client = new OpenUIClient({ baseUrl: this.getAttribute("base-url") || "" });
    if (this.getAttribute("model")) return;
    try {
      const config = await this.client.config();
      this.model = config.defaultModel;
    } catch (error) {
      this.dispatchEvent(
        new CustomEvent("openui-error", { detail: error, bubbles: true })
      );
    }
  }

  get model() {
    return this.getAttribute("model") || "";
  }

  set model(value) {
    if (value) this.setAttribute("model", value);
  }

  get providerId() {
    return this.getAttribute("provider-id") || "default";
  }

  render() {
    this.shadowRoot.innerHTML = `
      <style>${styles}</style>
      <section class="shell">
        <header><i></i><span>OpenUI JS</span></header>
        <main class="messages" aria-live="polite"></main>
        <form>
          <textarea rows="1"></textarea>
          <button type="submit" aria-label="Send">↑</button>
        </form>
      </section>
    `;
    this.list = this.shadowRoot.querySelector(".messages");
    this.form = this.shadowRoot.querySelector("form");
    this.input = this.shadowRoot.querySelector("textarea");
    this.button = this.shadowRoot.querySelector("button");
    this.input.placeholder = this.getAttribute("placeholder") || "메시지를 입력하세요";
    this.form.addEventListener("submit", (event) => {
      event.preventDefault();
      if (this.generating) {
        this.controller?.abort();
        return;
      }
      this.send(this.input.value);
    });
    this.input.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        this.form.requestSubmit();
      }
    });
    this.renderMessages();
  }

  renderMessages() {
    if (!this.list) return;
    this.list.replaceChildren();
    if (!this.messages.length) {
      const welcome = document.createElement("p");
      welcome.className = "welcome";
      welcome.textContent =
        this.getAttribute("welcome") || "무엇을 같이 만들어볼까요?";
      this.list.append(welcome);
      return;
    }
    for (const message of this.messages) {
      const article = document.createElement("article");
      article.className = message.role;
      const author = document.createElement("b");
      author.textContent = message.role === "user" ? "나" : "OpenUI JS";
      const content = document.createElement("p");
      content.textContent = message.content;
      article.append(author, content);
      if (message.sources?.length) {
        const sources = document.createElement("div");
        sources.className = "sources";
        for (const source of message.sources) {
          try {
            const url = new URL(source.url);
            if (!["http:", "https:"].includes(url.protocol)) continue;
            const link = document.createElement("a");
            link.href = url.href;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            link.textContent = source.title;
            sources.append(link);
          } catch {
            // Ignore malformed source URLs.
          }
        }
        article.append(sources);
      }
      if (message.toolEvents?.length) {
        const tools = document.createElement("div");
        tools.className = "tools";
        for (const event of message.toolEvents) {
          const item = document.createElement("span");
          item.textContent = `${event.status === "success" ? "✓" : "!"} ${event.name}`;
          tools.append(item);
        }
        article.append(tools);
      }
      this.list.append(article);
    }
    this.list.scrollTop = this.list.scrollHeight;
  }

  async send(content) {
    const text = String(content || "").trim();
    if (!text || this.generating || !this.client || !this.model) return;
    const user = {
      id: messageId(),
      role: "user",
      content: text,
      createdAt: Date.now()
    };
    const assistant = {
      id: messageId(),
      role: "assistant",
      content: "",
      sources: [],
      toolEvents: [],
      createdAt: Date.now()
    };
    const requestMessages = [...this.messages, user];
    this.messages.push(user, assistant);
    this.input.value = "";
    this.generating = true;
    this.button.textContent = "■";
    this.controller = new AbortController();
    this.renderMessages();
    this.dispatchEvent(
      new CustomEvent("openui-message", { detail: user, bubbles: true })
    );
    try {
      for await (const delta of this.client.streamChat(
        {
          model: this.model,
          providerId: this.providerId,
          messages: requestMessages.map(({ role, content: value }) => ({
            role,
            content: value
          })),
          useWeb: this.hasAttribute("use-web"),
          useTools: this.hasAttribute("use-tools")
        },
        {
          signal: this.controller.signal,
          onSources: (sources) => {
            assistant.sources = sources;
            this.renderMessages();
            this.dispatchEvent(
              new CustomEvent("openui-sources", {
                detail: sources,
                bubbles: true
              })
            );
          },
          onTools: (events) => {
            assistant.toolEvents = events;
            this.renderMessages();
            this.dispatchEvent(
              new CustomEvent("openui-tools", {
                detail: events,
                bubbles: true
              })
            );
          }
        }
      )) {
        assistant.content += delta;
        this.renderMessages();
      }
      this.dispatchEvent(
        new CustomEvent("openui-message", { detail: assistant, bubbles: true })
      );
    } catch (error) {
      if (error.name !== "AbortError") {
        assistant.content = `Error: ${error.message}`;
        this.dispatchEvent(
          new CustomEvent("openui-error", { detail: error, bubbles: true })
        );
      }
      this.renderMessages();
    } finally {
      this.controller = null;
      this.generating = false;
      this.button.textContent = "↑";
      this.input.focus();
    }
  }
}

export function defineOpenUIChat(tagName = "openui-chat") {
  if (typeof customElements !== "undefined" && !customElements.get(tagName)) {
    customElements.define(tagName, OpenUIChatElement);
  }
}

if (typeof customElements !== "undefined") defineOpenUIChat();
