# OpenUI JS

Svelte 없이 **React와 바닐라 JavaScript 두 가지 프런트엔드**를 제공하고, 하나의 Python/FastAPI 백엔드를 공유하는 AI 채팅 UI입니다. OpenAI 호환 API와 Ollama를 연결할 수 있습니다.

> OpenUI JS는 Open WebUI 프로젝트의 포크가 아닌 독립 구현입니다.

## 주요 기능

- React 기반 반응형 프런트엔드
- 프레임워크 없는 바닐라 JavaScript 프런트엔드
- 두 UI가 같은 FastAPI와 기능·디자인을 공유
- Python/FastAPI 스트리밍 프록시
- 이메일 회원가입·로그인과 HttpOnly 세션
- 사용자별 SQLite 대화 저장·동기화
- TXT·Markdown·PDF 문서 업로드와 사용자별 지식 저장소
- SQLite FTS5 기반 관련 문서 검색과 출처 태그 RAG
- 사용자별 장기 메모리 저장·편집·검색과 채팅 컨텍스트 주입
- 선택형 실시간 웹 검색과 답변별 클릭 가능한 출처
- 이미지 첨부를 OpenAI 호환 멀티모달 메시지로 전달
- 대화 본문 검색, 보관함, Markdown/JSON 내보내기
- 여러 OpenAI 호환 공급자와 모델을 대화별로 선택
- 안전한 계산기·현재 시각 함수 도구와 허용 목록 기반 원격 MCP 도구
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
| `DATABASE_PATH` | `data/openui.db` | SQLite 데이터베이스 경로 |
| `SESSION_TTL_DAYS` | `30` | 로그인 유지 기간 |
| `COOKIE_SECURE` | `false` | HTTPS 배포 시 `true` |
| `REQUIRE_AUTH` | `true` | 모델·채팅 API에 로그인 요구 |
| `ALLOW_REGISTRATION` | `true` | 새 계정 가입 허용 |
| `ENABLE_MEMORIES` | `true` | 사용자 메모리 기능 활성화 |
| `MEMORY_USER_CHAR_LIMIT` | `2000` | 채팅에 주입할 사용자 정보·선호 최대 글자 수 |
| `MEMORY_CONTEXT_CHAR_LIMIT` | `2000` | 검색해 주입할 장기 맥락 최대 글자 수 |
| `ENABLE_WEB_SEARCH` | `false` | 웹 검색·URL 가져오기 API 활성화 |
| `WEB_SEARCH_PROVIDER` | `external` | `external` JSON POST 또는 `searxng` |
| `WEB_SEARCH_URL` | 빈 값 | 검색 서비스 엔드포인트 |
| `WEB_SEARCH_API_KEY` | 빈 값 | 검색 서비스 서버 측 인증 키 |
| `WEB_SEARCH_RESULT_COUNT` | `5` | 질문당 검색 결과 수(최대 10) |
| `PROVIDERS_JSON` | `[]` | 추가 OpenAI 호환 공급자 배열 |
| `ENABLE_TOOLS` | `true` | 함수 호출·MCP 도구 기능 활성화 |
| `MCP_SERVERS_JSON` | `[]` | 원격 MCP 서버와 자동 실행 허용 도구 배열 |

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

## 문서 검색(RAG)

로그인 후 상단의 **지식** 버튼에서 `.txt`, `.md`, `.markdown`, `.pdf` 파일을 올릴 수 있습니다. 파일당 최대 크기는 10MB이며 PDF는 최대 500페이지까지 처리합니다.

업로드된 텍스트는 작은 조각으로 나뉘어 SQLite에 저장되고, 질문할 때 FTS5 키워드 검색 결과가 모델 입력에 `[Source N]` 형식으로 추가됩니다. 별도의 임베딩 모델이나 벡터 데이터베이스는 필요하지 않습니다. 스캔 이미지로만 구성된 PDF에는 OCR이 적용되지 않습니다.

개인정보 노출 범위를 줄이기 위해 원본 파일 바이트는 보관하지 않으며, 추출된 텍스트 조각과 파일명·크기 등의 메타데이터만 저장합니다. 문서를 삭제하면 검색 인덱스와 텍스트 조각도 함께 삭제됩니다.

## 메모리

로그인 후 상단의 **메모리** 버튼에서 새 대화에도 유지할 사용자 정보·선호 또는 장기 맥락을 직접 추가하고 수정·삭제할 수 있습니다. 각 메시지의 **기억하기**를 누르면 내용을 검토한 뒤 저장할 수 있으며, 자동으로 저장되지는 않습니다.

사용자 정보·선호는 설정된 글자 수 안에서 항상 참고하고, 장기 맥락은 현재 질문과 관련된 항목만 SQLite FTS5로 검색해 모델 컨텍스트에 추가합니다. 채팅 입력창에서 메모리 사용 여부를 확인할 수 있고 메모리 서랍에서 기능을 끌 수 있습니다.

메모리는 계정별로 격리되며 비밀번호, API 키, 인증 토큰 등 민감정보는 저장하지 않는 것을 권장합니다. 모든 메모리는 관리 화면에서 한 번에 초기화할 수 있습니다.

## 웹 검색과 이미지

웹 검색을 사용하려면 `ENABLE_WEB_SEARCH=true`와 검색 엔드포인트를 설정합니다. `searxng`는 JSON 검색 URL에 GET 요청을 보내며, `external`은 `{"query":"...","count":5}` 형태의 JSON POST API를 사용합니다. 브라우저에는 검색 서비스 키가 노출되지 않습니다.

채팅 입력창에서 **웹 검색**을 켜면 최신 검색 스니펫이 신뢰할 수 없는 참고 자료로 모델에 전달되고, 응답 아래에 원문 링크가 표시됩니다. **이미지** 버튼으로 PNG, JPEG, WebP, GIF를 최대 3개, 파일당 2MB까지 첨부할 수 있습니다. 선택한 모델 서버가 이미지 입력을 지원해야 합니다.

사이드바 검색은 대화 제목과 본문을 함께 찾습니다. 대화를 보관함으로 옮기거나, 로그인 상태에서는 Markdown으로, 로컬 상태에서는 JSON으로 내보낼 수 있습니다.

## 여러 모델 공급자

기본 `API_BASE_URL` 외에 여러 OpenAI 호환 엔드포인트를 추가할 수 있습니다. 키는 `/api/config`에 포함되지 않고 모델·채팅 요청 때 서버에서만 사용됩니다.

```env
PROVIDERS_JSON=[{"id":"cloud","name":"Cloud","baseUrl":"https://api.example.com/v1","apiKey":"server-secret","defaultModel":"model-x"}]
```

공급자를 둘 이상 설정하면 React와 바닐라 UI의 상단에 공급자 선택기가 나타납니다. 공급자와 모델 선택은 대화별로 저장됩니다.

## 함수 호출과 MCP

**도구**를 켜면 모델에 부작용 없는 내장 `calculator`, `current_time` 함수를 제공합니다. 도구 모드를 지원하지 않는 OpenAI 호환 모델에서는 이 기능을 끄세요. 도구 사용 중에는 모델의 함수 호출과 결과 확인을 위해 응답이 한 번에 표시될 수 있습니다.

원격 Streamable HTTP MCP 서버도 연결할 수 있습니다. 서버가 모델에 노출하고 자동 실행해도 되는 도구만 `allowedTools`에 명시해야 합니다. 헤더 값은 서버 설정에만 남습니다.

```env
MCP_SERVERS_JSON=[{"id":"docs","name":"Docs MCP","url":"https://mcp.example.com/rpc","headers":{"Authorization":"Bearer server-secret"},"allowedTools":["search_docs"]}]
```

OpenUI JS는 MCP 세션 초기화 후 `tools/list`와 `tools/call`을 사용합니다. 도구 허용 목록은 관리자의 자동 실행 승인으로 취급되므로, 쓰기·삭제·결제처럼 부작용이 있는 도구는 넣지 않는 것을 권장합니다.

## 구조

```text
.
├── backend/
│   ├── main.py         # FastAPI + OpenAI 호환 스트리밍 프록시
│   ├── database.py     # SQLite 사용자·세션·대화·문서 저장소
│   ├── rag.py          # 텍스트 추출·청킹·RAG 컨텍스트
│   ├── memory.py       # 사용자 메모리 컨텍스트 생성
│   ├── web_search.py   # 웹 검색·공개 URL 가져오기와 SSRF 차단
│   ├── providers.py    # 다중 OpenAI 호환 공급자 구성
│   ├── tools.py        # 내장 함수 도구와 원격 MCP 클라이언트
│   ├── security.py     # 비밀번호와 세션 토큰 보안
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
- 비밀번호는 PBKDF2-SHA256으로, 로그인 토큰은 SHA-256으로 해시해 저장합니다.
- 로그인 쿠키는 HttpOnly와 SameSite=Lax로 제한됩니다.
- 사용자별 대화 소유권은 모든 저장 API에서 서버가 확인합니다.
- 문서 목록·검색·삭제도 로그인 사용자별로 격리합니다.
- 메모리 CRUD·검색 역시 로그인 사용자 소유권을 검사합니다.
- 검색된 문서 내용은 신뢰할 수 없는 참고 데이터로 표시해 모델에 전달합니다.
- 웹 페이지 가져오기는 HTTP(S)만 허용하고 사설·루프백·링크 로컬 주소와 리다이렉트를 검사합니다.
- 이미지 첨부는 허용 MIME, 개수, 파일 크기를 서버에서 다시 검증합니다.
- 추가 공급자와 MCP 인증 헤더는 공개 설정 응답이나 채팅 저장 데이터에 포함하지 않습니다.
- 원격 MCP 도구는 서버 설정의 `allowedTools` 항목만 모델에 노출하고 실행합니다.
- 모델·채팅 API는 기본적으로 로그인한 사용자만 호출할 수 있습니다.
- 첫 운영 계정을 만든 뒤 `ALLOW_REGISTRATION=false`로 설정하면 추가 가입을 막을 수 있습니다.
- 이 앱은 개인/로컬 사용을 위한 경량 구현입니다.
- 외부에 공개하려면 인증, 요청 제한, HTTPS를 앞단에 추가하세요.

## 라이선스

MIT
