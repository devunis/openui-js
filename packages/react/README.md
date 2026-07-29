# @openui-js/react

OpenUI JS용 React Provider와 headless 채팅 훅입니다. UI 마크업과 스타일은 포함하지 않으므로 제품 디자인 시스템에 맞게 렌더링할 수 있습니다.

```jsx
<OpenUIProvider options={{ baseUrl: "https://chat.example.com" }}>
  <Chat />
</OpenUIProvider>
```

`useOpenUIChat()`은 `messages`, `send`, `stop`, `reset`, `streaming`, `error`를 반환합니다.
