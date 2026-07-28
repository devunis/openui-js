# OpenUI JS

Svelte 없이 **React와 바닐라 JavaScript 두 가지 프런트엔드**를 제공하고, 하나의 Python/FastAPI 백엔드를 공유하는 AI 채팅 UI입니다. OpenAI 호환 API와 Ollama를 연결할 수 있습니다.

> OpenUI JS는 Open WebUI 프로젝트의 포크가 아닌 독립 구현입니다.

## 주요 기능

- React 기반 반응형 프런트엔드
- 프레임워크 없는 바닐라 JavaScript 프런트엔드
- 두 UI가 같은 FastAPI와 기능·디자인을 공유
- Python/FastAPI 스트리밍 프록시
- OpenAI 호환 `/v1` API 지원
- Ollama의 OpenAI 호환 API 지원
- 실시간 스트리밍 응답
- 서버에서 자동으로 모델 목록 조회
- 브라우저 로컬 채팅 기록
- 반응형 모바일 UI
- 라이트/다크 테마
- 안전한 서버 측 API 키 보관

## 빠른 시작

Node.js 20 이상과 Python 3.11 이상이 필요합니다.

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
npm install
cp .env.example .env
```

### Ollama

```bash
ollama serve
API_BASE_URL=http://localhost:11434/v1 DEFAULT_MODEL=llama3.2 \
  uvicorn backend.main:app --reload --port 8000
```

다른 터미널에서 원하는 프런트엔드를 실행합니다.

```bash
# React — http://127.0.0.1:3000
npm run dev:react

# Vanilla JS — http://127.0.0.1:3001
npm run dev:vanilla
```

### OpenAI 또는 호환 서비스

```bash
API_BASE_URL=https://api.openai.com/v1 \
OPENAI_API_KEY=sk-your-key \
DEFAULT_MODEL=gpt-4.1-mini \
  uvicorn backend.main:app --reload --port 8000
```

OpenAI 호환 규격을 제공하는 로컬 서버나 다른 서비스도 `API_BASE_URL`만 바꾸면 연결할 수 있습니다.

## 환경변수

| 변수 | 기본값 | 설명 |
| --- | --- | --- |
| `API_BASE_URL` | `http://localhost:11434/v1` | OpenAI 호환 API 주소 |
| `OPENAI_API_KEY` | 빈 값 | 모델 서버 인증 키 |
| `DEFAULT_MODEL` | `llama3.2` | 기본 모델 |
| `PORT` | `8000` | 백엔드 포트 |
| `HOST` | `127.0.0.1` | 백엔드 바인딩 주소 |

## 개발

```bash
npm run dev
npm run dev:react
npm run dev:vanilla
npm run backend
npm run build
npm test
npm run check
```

`npm run build` 후 FastAPI를 실행하면 React는 <http://127.0.0.1:8000/react/>, Vanilla JS는 <http://127.0.0.1:8000/vanilla/>에서 동시에 사용할 수 있습니다.

## 구조

```text
.
├── backend/
│   ├── main.py         # FastAPI + OpenAI 호환 스트리밍 프록시
│   └── test_main.py    # 백엔드 API 테스트
├── frontends/
│   ├── react/          # React 구현
│   ├── vanilla/        # 순수 HTML/JavaScript 구현
│   └── shared/         # 두 UI가 공유하는 스타일
├── vite.react.config.js
└── vite.vanilla.config.js
```

## 보안 참고

- API 키는 서버 프로세스에만 전달되고 브라우저 응답에는 포함되지 않습니다.
- 이 앱은 개인/로컬 사용을 위한 경량 구현입니다.
- 외부에 공개하려면 인증, 요청 제한, HTTPS를 앞단에 추가하세요.

## 라이선스

MIT
