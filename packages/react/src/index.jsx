import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState
} from "react";

import { OpenUIClient } from "../../core/src/index.js";

const OpenUIContext = createContext(null);

export function OpenUIProvider({ client, options, children }) {
  const [ownedClient] = useState(() => new OpenUIClient(options));
  const value = useMemo(() => client || ownedClient, [client, ownedClient]);
  return createElement(OpenUIContext.Provider, { value }, children);
}

export function useOpenUI() {
  const client = useContext(OpenUIContext);
  if (!client) {
    throw new Error("useOpenUI must be used inside an OpenUIProvider.");
  }
  return client;
}

function id() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function useOpenUIChat({
  model,
  providerId = "default",
  initialMessages = [],
  temperature = 0.7,
  request = {}
}) {
  const client = useOpenUI();
  const [messages, setMessages] = useState(initialMessages);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState(null);
  const controllerRef = useRef(null);
  const messagesRef = useRef(initialMessages);
  messagesRef.current = messages;

  const stop = useCallback(() => controllerRef.current?.abort(), []);

  const send = useCallback(
    async (content, overrides = {}) => {
      if (controllerRef.current) return null;
      const text = typeof content === "string" ? content.trim() : "";
      const attachments = overrides.attachments || [];
      if (!text && !attachments.length) return null;

      const userMessage = {
        id: id(),
        role: "user",
        content: text,
        attachments,
        createdAt: Date.now()
      };
      const assistantMessage = {
        id: id(),
        role: "assistant",
        content: "",
        sources: [],
        toolEvents: [],
        createdAt: Date.now()
      };
      const requestMessages = [...messagesRef.current, userMessage];
      setMessages([...requestMessages, assistantMessage]);
      setStreaming(true);
      setError(null);
      controllerRef.current = new AbortController();
      let fullContent = "";

      try {
        for await (const delta of client.streamChat(
          {
            model,
            providerId,
            temperature,
            ...request,
            ...overrides,
            attachments: undefined,
            messages: requestMessages.map(
              ({ role, content: messageContent, attachments: messageAttachments }) => ({
                role,
                content: messageContent,
                attachments: messageAttachments || []
              })
            )
          },
          {
            signal: controllerRef.current.signal,
            onSources: (sources) =>
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, sources }
                    : message
                )
              ),
            onTools: (toolEvents) =>
              setMessages((current) =>
                current.map((message) =>
                  message.id === assistantMessage.id
                    ? { ...message, toolEvents }
                    : message
                )
              )
          }
        )) {
          fullContent += delta;
          setMessages((current) =>
            current.map((message) =>
              message.id === assistantMessage.id
                ? { ...message, content: fullContent }
                : message
            )
          );
        }
        return fullContent;
      } catch (caught) {
        if (caught.name !== "AbortError") setError(caught);
        throw caught;
      } finally {
        controllerRef.current = null;
        setStreaming(false);
      }
    },
    [client, model, providerId, request, temperature]
  );

  const reset = useCallback((nextMessages = []) => {
    controllerRef.current?.abort();
    setMessages(nextMessages);
    setError(null);
  }, []);

  return { messages, setMessages, send, stop, reset, streaming, error };
}

export { OpenUIClient };
