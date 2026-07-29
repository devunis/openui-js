# @openui-js/web-component

프레임워크 없이 삽입할 수 있는 `<openui-chat>` 웹 컴포넌트입니다.

```html
<script type="module">
  import "@openui-js/web-component";
</script>
<openui-chat base-url="https://chat.example.com" model="model-a"></openui-chat>
```

Shadow DOM을 사용하며 `provider-id`, `use-web`, `use-tools`, `placeholder`, `welcome` 속성을 지원합니다.
메시지, 출처, 도구 실행, 오류는 각각 `openui-message`, `openui-sources`, `openui-tools`, `openui-error` 이벤트로 받을 수 있습니다.
