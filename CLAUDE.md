# docvault

관리자가 계정을 발급하는 폐쇄형 문서 열람·편집 플랫폼. MD/HTML에서 시작해 코드·이미지·PDF로 형식 확장 예정. 설계 문서는 [docs/design/](docs/design/)에 있으며, 구현이 설계와 어긋나게 되면 코드가 아니라 문서를 먼저 갱신하고 진행한다.

## 명령어

| 명령 | 설명 |
|---|---|
| `npm run dev:server` | Hono API 서버 (3000, watch 모드) |
| `npm run dev:client` | Vite 개발 서버 (5173, `/api` → 3000 프록시) |
| `npm run build` | 클라이언트 타입체크 + 빌드 |
| `npm run typecheck -w server` | 서버 타입체크 |
| `npm run db:generate -w server` | 스키마 변경 후 마이그레이션 SQL 생성 |

- 마이그레이션은 서버 기동 시 자동 적용된다. 스키마를 바꾸면 `db:generate`만 돌리면 됨.
- DB 초기화가 필요하면 `data/` 폴더를 지우고 서버를 재기동한다 (admin 계정 자동 재시드).

## 구조

- `client/` — React 19 + Vite + Tailwind 4 SPA
- `server/` — Hono + Drizzle + better-sqlite3. DB 스키마·마이그레이션·시드는 `server/src/db/`
- `data/` — SQLite 파일 + 바이너리 원본. gitignore 대상. 이 폴더가 곧 백업 단위
- 텍스트 파일 본문은 DB(`files.content_text`)에, 바이너리는 디스크(`data/files/{ownerId}/{uuid}`)에 저장하고 DB에는 경로만 둔다
- 타임스탬프는 전부 unix epoch 밀리초 정수(UTC)

## 코드 규칙

**모듈화**
- 파일 하나 = 역할 하나. 서버 라우트는 도메인별 파일로 분리한다 (`routes/auth.ts`, `routes/files.ts`, ...) — API 명세서의 ID 그룹(001x 인증, 02x 폴더, 03x 파일...)과 대응시킨다.
- 라우트 핸들러에는 요청 파싱·검증·응답만 두고, 비즈니스 로직은 별도 함수(서비스)로 뽑는다. 핸들러가 30줄을 넘어가면 분리 신호.
- 클라이언트 컴포넌트도 화면 ID(SCR-xxx) 단위로 파일을 나누고, 두 곳 이상에서 쓰는 로직은 훅이나 유틸로 추출한다.
- 같은 코드를 세 번째 복사하게 되면 그때 공통화한다. 두 번까지는 중복 허용 (성급한 추상화 금지).

**주석**
- 주석은 "왜"를 설명할 때만 단다. 코드만 봐서는 알 수 없는 의도·제약·설계 결정이 대상이다.
  - 좋은 예: `// 복원도 하나의 편집으로 취급 — 현재 본문을 먼저 스냅샷한다`
  - 나쁜 예: `// 파일을 삭제한다` (코드가 이미 말하고 있음)
- 설계 문서의 결정을 구현하는 지점에는 해당 결정을 한 줄로 남긴다 (문서 안 보고도 코드가 읽히게).
- 주석은 한국어로 쓴다.

**공통**
- TypeScript strict 유지. `any` 금지, 불가피하면 `unknown` + 좁히기.
- 모든 API 입력은 zod로 검증한다. 검증 실패는 `VALIDATION_ERROR` 400.
- 에러 응답은 공통 형식 `{ code, message }` (API 명세서의 에러 코드 표 참조).
- 서버 함수명은 동사로 시작 (`getTree`, `saveContent`), 컴포넌트는 명사 (`FileTree`, `Viewer`).
- 네이밍 경계: DB 컬럼은 snake_case, API JSON과 TS 코드는 camelCase. 변환은 Drizzle 스키마 정의가 담당하고 그 밖에서 수동 변환하지 않는다.
- 설계 상수(버전 보관 20개, 텍스트 10MB 제한, 세션 7일 등)는 `server/src/constants.ts` 한 곳에 모은다. 코드에 매직 넘버 금지.

**보안 (deny by default)**
- 인증 미들웨어를 `/api/v1` 전체에 기본 적용하고, 예외(`/auth/login`)를 명시한다. 라우트마다 인증을 "추가"하는 방식 금지 — 빼먹으면 뚫리는 구조를 만들지 않는다.
- 권한 검사(소유자/공유/관리자)는 라우트가 아니라 공용 함수 하나(`assertFileAccess` 류)로 통일한다.
- 사용자 입력이 경로가 되는 곳(파일명, storage_path)은 반드시 정규화·검증한다 (path traversal 방지).

## 커밋

- 형식: `타입: 요약` — 타입은 feat / fix / refactor / docs / chore. 요약은 한국어.
  - 예: `feat: 로그인 API + 세션 쿠키 발급`, `refactor: 파일 라우트에서 권한 검사 분리`
- 단계(기능) 하나가 동작 확인되면 커밋 하나. 여러 기능을 한 커밋에 섞지 않는다.

## 주의

- `better-sqlite3`는 동기 드라이버 — Drizzle에서 `.returning()`은 `.get()`/`.all()`로 실행해야 한다.
- admin 초기 비밀번호는 `admin1234` (env `ADMIN_INITIAL_PASSWORD`). 배포 시 `JWT_SECRET` 필수.
- 커밋은 사용자가 요청할 때만 한다.
