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

## 구조

```text
.
├── backend/
│   ├── main.py         # FastAPI + OpenAI 호환 스트리밍 프록시
│   ├── database.py     # SQLite 사용자·세션·대화·문서 저장소
│   ├── rag.py          # 텍스트 추출·청킹·RAG 컨텍스트
│   ├── memory.py       # 사용자 메모리 컨텍스트 생성
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
- 모델·채팅 API는 기본적으로 로그인한 사용자만 호출할 수 있습니다.
- 첫 운영 계정을 만든 뒤 `ALLOW_REGISTRATION=false`로 설정하면 추가 가입을 막을 수 있습니다.
- 이 앱은 개인/로컬 사용을 위한 경량 구현입니다.
- 외부에 공개하려면 인증, 요청 제한, HTTPS를 앞단에 추가하세요.

## 라이선스

MIT
