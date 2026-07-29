# @openui-js/core

브라우저와 Node.js에서 사용할 수 있는 OpenUI JS headless ESM 클라이언트입니다. `OpenUIClient`는 인증, 모델, 대화 저장과 SSE 채팅 스트리밍을 제공합니다.

```js
import { OpenUIClient } from "@openui-js/core";

const client = new OpenUIClient({ baseUrl: "https://chat.example.com" });
for await (const delta of client.streamChat({
  model: "model-a",
  messages: [{ role: "user", content: "Hello" }]
})) {
  console.log(delta);
}
```
