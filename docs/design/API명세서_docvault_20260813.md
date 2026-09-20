# API 명세서: docvault

| 작성자 | | 작성일 | 2026-08-13 | 버전 | v0.1 | Base URL | /api/v1 (동일 오리진) |

## 공통 규약

- **인증**: 로그인 성공 시 JWT를 httpOnly 쿠키 `dv_session`으로 발급 (유효기간 7일, SameSite=Lax, 배포 시 Secure). 이후 모든 요청은 쿠키로 자동 인증되며 Authorization 헤더를 사용하지 않습니다.
- **권한 등급**: 공개(로그인 불필요) 없음 — 로그인 화면 외 전 API가 인증 필수. `관리자` 표시 API는 role=admin만 호출 가능.
- **파일 접근 규칙**: 소유자 본인, is_shared=1인 파일(및 공유 폴더 하위 파일)의 열람, 관리자는 전체 접근. 공유 파일은 열람 전용(수정 불가).
- **공통 에러 응답**: `{ "code": "ERROR_CODE", "message": "설명" }`
- **처리 시간 헤더**: 모든 `/api/v1` 응답에 `Server-Timing: app;dur=<ms>` — 서버가 그 요청에 실제로 쓴 시간. 클라이언트의 시작 시간 표(SCR-306)가 회선과 서버를 가르는 데 쓴다. API-021 `/tree`는 앞에 `folders`·`files`·`state`·`tags` 부분 시간을 더 단다. 0.5초(`SLOW_REQUEST_MS`) 넘게 일한 요청은 서버 로그에 `[slow]`로 이 헤더 전체가 찍힌다. 정적 파일은 `/assets/*` 1년 immutable, `index.html` no-cache.

| 코드 | HTTP | 의미 |
|---|---|---|
| VALIDATION_ERROR | 400 | 입력값 오류 (zod 검증 실패) |
| UNAUTHORIZED | 401 | 미로그인 / 세션 만료 |
| FORBIDDEN | 403 | 권한 없음 (관리자 전용, 비활성 계정, **열람은 되지만 수정 권한이 없는 경우**) |
| TOO_MANY_ATTEMPTS | 429 | 로그인 시도 초과 (Retry-After 헤더에 대기 초) |
| NOT_FOUND | 404 | 대상 없음, **또는 열람 권한이 없는 자원** (403은 존재를 알려 주므로 통일 — 정보 노출 방지) |
| CONFLICT | 409 | 중복 (username, 같은 폴더 내 동일 이름 등) |
| PAYLOAD_TOO_LARGE | 413 | 업로드 크기 초과 |
| GOOGLE_NOT_CONNECTED | 409 | 구글 계정 미연결 (클라이언트는 연결 화면으로 유도) |
| GOOGLE_ERROR | 502 | 구글 API 호출 실패 — 토큰 만료·사용자가 권한 회수·드라이브 장애. message에 사람이 읽을 사유 |
| ASK_NOT_CONFIGURED | 503 | 서버에 LLM API 키(`ANTHROPIC_API_KEY`)가 없음. 질문 기능만 막히고 나머지는 정상 |
| ASK_LIMIT_EXCEEDED | 429 | 오늘 질문 한도(30) 초과. 읽기·지난 대화는 됨 |
| ASK_UPSTREAM_ERROR | 502 | LLM 호출 실패 (인증·과부하·시간 초과). 스트리밍 중이면 `error` 이벤트로 옴. 사용자 질문은 저장돼 있어 다시 시도 가능 |

## API 목록

| ID | 메서드 | 경로 | 설명 | 권한 |
|---|---|---|---|---|
| API-001 | POST | /auth/login | 로그인 | 공개 |
| API-002 | POST | /auth/logout | 로그아웃 (쿠키 삭제) | 로그인 |
| API-003 | GET | /auth/me | 내 정보 조회 | 로그인 |
| API-004 | PUT | /auth/password | 내 비밀번호 변경 | 로그인 |
| API-011 | GET | /admin/stats | 대시보드 통계 (사용자·파일 수 등) | 관리자 |
| API-012 | GET | /admin/users | 사용자 목록 | 관리자 |
| API-013 | POST | /admin/users | 사용자 생성 | 관리자 |
| API-014 | PUT | /admin/users/{id} | 사용자 수정 (이름·역할·활성화·비밀번호 초기화) | 관리자 |
| API-015 | DELETE | /admin/users/{id} | 사용자 삭제 (소유 데이터 CASCADE) | 관리자 |
| API-016 | GET | /admin/tree | 전체 사용자 파일·폴더 트리 | 관리자 |
| API-017 | GET | /admin/backup | 자동 백업 설정·최근 실행 결과 조회 | 관리자 |
| API-018 | PUT | /admin/backup | 자동 백업 설정 저장 (on/off·시각·보관 개수) | 관리자 |
| API-019 | POST | /admin/backup/run | 지금 즉시 백업 실행 | 관리자 |
| API-020 | GET | /admin/ask-usage | AI 사용량 — 사용자별 질문 수(오늘/7일/30일)·30일 토큰·검색·추정 비용, 많이 물어본 문서 | 관리자 |
| API-021 | GET | /tree | 내 폴더·파일 트리 (탐색기 초기 로드) | 로그인 |
| API-022 | POST | /folders | 폴더 생성 | 로그인 |
| API-023 | PUT | /folders/{id} | 폴더 이름 변경 / 이동 / 정렬 | 로그인 |
| API-024 | DELETE | /folders/{id} | 폴더 삭제 (하위 포함) | 로그인 |
| API-025 | PUT | /folders/{id}/share | 폴더 공유 토글 | 관리자 |
| API-031 | POST | /files | 파일 업로드 (multipart) | 로그인 |
| API-032 | GET | /files/{id} | 파일 메타 조회 (정보 모달용) | 로그인 |
| API-033 | GET | /files/{id}/content | 텍스트 본문 조회 (JSON) | 로그인 |
| API-034 | PUT | /files/{id}/content | 본문 저장 (버전 스냅샷 포함) | 로그인 |
| API-035 | PUT | /files/{id} | 이름 변경 / 이동 / 정렬 | 로그인 |
| API-036 | DELETE | /files/{id} | 파일 삭제 → 휴지통 이동 (soft delete, 2026-08-15) | 로그인 |
| API-037 | POST | /files/{id}/copy | 파일 복사 | 로그인 |
| API-038 | GET | /files/{id}/raw | 원본 다운로드 / 바이너리 스트리밍 | 로그인 |
| API-039 | PUT | /files/{id}/share | 파일 공유 토글 | 관리자 |
| API-040 | GET | /files/archive | 선택·폴더·전체를 ZIP 하나로 내보내기 (스트리밍, 2026-08-15) | 로그인 |
| API-044 | GET | /files/trash | 휴지통 목록 (내 파일) | 로그인 |
| API-045 | DELETE | /files/trash | 휴지통 비우기 (전체 영구 삭제) | 로그인 |
| API-046 | POST | /files/{id}/restore | 휴지통에서 복원 (충돌 시 자동 개명, 폴더 소실 시 최상위) | 소유자 |
| API-047 | DELETE | /files/{id}/purge | 휴지통에서 영구 삭제 | 소유자 |
| API-041 | GET | /files/{id}/versions | 버전 목록 (본문 제외 메타) | 로그인 |
| API-042 | GET | /files/{id}/versions/{vid} | 특정 버전 본문 (미리보기) | 로그인 |
| API-043 | POST | /files/{id}/versions/{vid}/restore | 해당 버전으로 복원 | 로그인 |
| API-051 | GET | /tags | 내 태그 목록 | 로그인 |
| API-052 | POST | /tags | 태그 생성 | 로그인 |
| API-053 | DELETE | /tags/{id} | 태그 삭제 (연결 CASCADE) | 로그인 |
| API-054 | PUT | /files/{id}/tags | 파일의 태그 목록 교체 | 로그인 |
| API-061 | GET | /shared/tree | 공유 파일·폴더 트리 (열람 전용) | 로그인 |
| API-071 | GET | /me/settings | 뷰어 설정 조회 | 로그인 |
| API-072 | PUT | /me/settings | 뷰어 설정 저장 (테마·글자 크기·HTML 글자 배율·본문 너비·용어 밑줄 termHighlight·질문 때 카드 askWithCards, 0/1) | 로그인 |
| API-073 | PUT | /me/files/{id}/state | 즐겨찾기·읽던 위치·열람 기록·화면 맞춤 저장 | 로그인 |
| API-074 | GET | /me/recent | 최근 열람 파일 목록 | 로그인 |
| API-075 | GET | /me/files/{id}/state | 파일 열람 상태 조회 (문서 열 때 최신 위치 복원용) | 로그인 |
| API-081 | GET | /search?q= | 파일명+본문 전문 검색 (FTS5) | 로그인 |
| API-091 | GET | /google/status | 내 구글 계정 연결 상태 (이메일·연결 시각) | 로그인 |
| API-092 | POST | /google/connect | 구글 동의 화면 URL 발급 (state 발급) | 로그인 |
| API-093 | GET | /google/callback | 구글 리디렉트 수신 → 토큰 교환·저장 | 로그인 |
| API-094 | DELETE | /google/connect | 연결 해제 (구글 쪽 권한도 회수) | 로그인 |
| API-095 | GET | /google/picker | 구글 피커 구동에 필요한 값 (clientId·appId·단기 토큰) | 로그인 |
| API-096 | GET | /google/recent | 최근 연 드라이브 문서 목록 (바로가기) | 로그인 |
| API-097 | DELETE | /google/recent/{driveFileId} | 바로가기 목록에서 제거 | 로그인 |
| API-098 | GET | /google/files/{driveFileId}/content | 드라이브 문서 메타+텍스트 본문 (구글 문서는 md로 변환) | 로그인 |
| API-099 | GET | /google/files/{driveFileId}/raw | 드라이브 원본 스트리밍 (PDF·이미지 등) | 로그인 |
| API-101 | GET | /ask/status | 질문 기능 상태 (키 설정 여부·오늘 남은 횟수·한도) | 로그인 |
| API-102 | POST | /ask/threads | 대화 시작 (문서·선택 문장·문맥을 붙여 빈 대화 생성) | 로그인 |
| API-103 | POST | /ask/threads/{id}/messages | 질문 보내기 → 답변 SSE 스트리밍. 요청 excludeCardIds[], meta 이벤트에 cards[] (활용 ④) | 소유자 |
| API-104 | GET | /ask/threads | 지난 대화 목록 (최근순, 본문 제외) | 로그인 |
| API-105 | GET | /ask/threads/{id} | 대화 하나 + 메시지 전부 | 소유자 |
| API-106 | DELETE | /ask/threads/{id} | 대화 삭제 | 소유자 |
| API-111 | GET | /cards | 내 카드 목록 (머리말 요약: 제목·한 줄·별칭·종류·주제·태그·연결·출처) | 로그인 |
| API-112 | POST | /cards/draft | 대화 전체·답 하나·고른 답들에서 카드 초안 + 비슷한 카드 판단 (LLM, 구조화 출력) | 소유자 |
| API-113 | POST | /cards/merge-preview | 기존 카드 + 대화 → 재구성 결과 미리보기 (LLM). 저장 안 함 | 소유자 |
| API-114 | POST | /cards | 카드 만들기 — md 파일 생성(kind=card), 이름=제목.md, 겹치면 (2) | 로그인 |
| API-115 | PUT | /cards/{id} | 카드 머리말·본문 갱신 (재구성 저장). 버전 스냅샷, 출처는 더하기만 | 소유자 |
| API-116 | GET/POST | /cards/outline | 대화 정리 1단계 — GET은 대화에 저장된 결과(없으면 null, stale 표시), POST는 개념 목록+주제 초안을 새로 만들어 저장 (본문 없음, 빠른 모델) | 소유자 |
| API-121 | POST | /cards/outline/item | 대화 정리 2단계 — 항목 하나의 본문(새 카드) 또는 재구성(이어쓰기). 결과를 저장된 정리에 채운다 | 소유자 |
| API-117 | POST | /cards/batch | 묶음 저장 — 개념 카드 N장(새로/이어쓰기) + 주제 카드 1장을 한 트랜잭션으로. LLM 없음. 되돌리기 재료 반환 | 소유자 |
| API-119 | GET | /cards/review | 오늘 복습할 카드 (예정 시각이 지난 것, 오래된 순, 하루 20장) + 내일 장수 | 로그인 |
| API-120 | POST | /cards/{id}/review | 채점 — again(내일) / ok(간격 두 배, 60일 상한). USER_FILE_STATE의 복습 칸만 갱신 | 소유자 |
| API-118 | GET/POST | /cards/export | 내보내기 — GET은 용어집 md·Anki CSV 텍스트(미리보기·다운로드), POST는 용어집을 내 파일 최상위 "용어집.md"로 만들거나 갱신 | 로그인 |

이하 핵심 API의 상세 규격입니다. 나머지는 목록의 설명과 공통 규약을 따르며 구현 시 구체화합니다.

---

## API-001: 로그인

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | POST /auth/login |
| 설명 | username·비밀번호 검증 후 세션 쿠키 발급. is_active=0 계정은 거부 |
| 인증 필요 | 아니오 |

### Request
**Body**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| username | string | Y | 로그인 ID |
| password | string | Y | 비밀번호 |

```json
{ "username": "alice", "password": "********" }
```

### Response
**200 OK** — `Set-Cookie: dv_session=...` 포함
| 필드 | 타입 | 설명 |
|---|---|---|
| user | object | { id, username, displayName, role } |

**에러**
| 코드 | HTTP | 설명 |
|---|---|---|
| INVALID_CREDENTIALS | 401 | ID/비밀번호 불일치 (어느 쪽인지 구분해 알려주지 않음) |
| ACCOUNT_DISABLED | 403 | 비활성화된 계정 |

---

## API-021: 내 트리 조회

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | GET /tree |
| 설명 | 탐색기 렌더링에 필요한 폴더·파일 전체를 1회 호출로 반환. 본문(content)은 제외 |
| 인증 필요 | 예 |

### Response
**200 OK**
| 필드 | 타입 | 설명 |
|---|---|---|
| folders | array | [{ id, parentId, name, isShared, sortOrder }] |
| files | array | [{ id, folderId, name, fileType, sizeBytes, isShared, sortOrder, updatedAt, tags: [tagId], state: { isFavorite, lastOpenedAt } }] |

트리 구조 조립(중첩)은 클라이언트가 수행합니다. 파일별 태그와 개인 상태(USER_FILE_STATE)를 조인해 함께 내려주어 탐색기 초기 로드를 1 요청으로 만듭니다.

---

## API-031: 파일 업로드

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | POST /files (multipart/form-data) |
| 설명 | 모든 확장자 수용(2026-08-27, 전량 수용 정책) → 확장자·내용 검사로 형식을 분류해 텍스트 계열은 본문을 DB에, 바이너리는 디스크에 저장. 여러 파일 동시 업로드 지원 |
| 인증 필요 | 예 |

### Request
**Body (multipart)**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| files | File[] | Y | 업로드 파일. 확장자 제한 없음 — 아는 확장자는 md/html/code/text/image/pdf/audio/video로, 모르는 확장자는 내용 검사(UTF-8·NUL 없음·10MB 이하)로 text 또는 binary로 분류 |
| folderId | number | N | 대상 폴더. 생략 시 루트 |

### Response
**201 Created**
| 필드 | 타입 | 설명 |
|---|---|---|
| files | array | 생성된 파일 메타 목록 (API-021의 files 항목과 동일 형태) |

**에러**
| 코드 | HTTP | 설명 |
|---|---|---|
| PAYLOAD_TOO_LARGE | 413 | 파일당 크기 제한 초과 (텍스트 10MB, 바이너리 50MB) |

업로드에서 UNSUPPORTED_TYPE은 더 이상 발생하지 않습니다(전량 수용). 이름 변경(API-035)에서 저장 방식의 경계(텍스트↔바이너리)를 넘는 확장자 변경 시에만 남아 있습니다.

---

## API-033: 본문 조회

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | GET /files/{id}/content |
| 설명 | 텍스트 계열 파일의 본문 반환. 바이너리 파일은 API-038 /raw 사용 |
| 인증 필요 | 예 (소유자 / 공유 열람 / 관리자) |

### Response
**200 OK**
| 필드 | 타입 | 설명 |
|---|---|---|
| id | number | 파일 ID |
| fileType | string | 렌더러 선택용 |
| content | string | 본문 텍스트 |
| updatedAt | number | 마지막 수정 (unix ms) |
| readonly | boolean | 공유 열람 등 수정 불가 여부 (편집 버튼 표시 제어) |

---

## API-040: ZIP 내보내기

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | GET /files/archive |
| 설명 | 고른 파일·폴더·내 자료 전체를 ZIP 하나로 묶어 스트리밍한다. 텍스트 본문은 DB에서, 바이너리는 디스크에서 꺼내 조립하므로 "폴더 압축"이 아니라 재구성 작업이다 |
| 인증 필요 | 예 (담기는 항목마다 열람 권한을 개별 검사 — 권한 없는 항목은 조용히 빠진다) |
| 비고 | GET인 이유: 브라우저가 주소만 열면 디스크로 바로 흘러가 큰 묶음도 메모리에 쌓이지 않는다 |

### Request
**Query**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| files | string | N | 파일 ID를 쉼표로 나열 (`1,2,3`). 최대 500개 |
| folders | string | N | 폴더 ID 목록. 하위 구조를 그대로 담는다. 최대 500개 |
| all | `1` | N | 내 파일 전체 (다른 사람 파일은 포함하지 않음) |
| manifest | `1` | N | 태그·즐겨찾기를 담은 `docvault-manifest.json` 동봉 |

`all`이 없고 files·folders도 비어 있으면 400. 셋 중 하나 이상 필요.

### Response
**200 OK** — `Content-Type: application/zip`, `Content-Disposition: attachment`
(스트리밍이라 Content-Length는 없다)

- **경로 규칙**: 폴더·전체 내보내기는 폴더 구조를 살리고(폴더 자신이 최상위 칸), 파일만 고른 경우는 평평하게 담는다
- **이름 규칙**: 폴더 하나면 `{폴더명}.zip`, 전체면 `docvault-전체-{YYYYMMDD}.zip`, 그 외 `docvault-{N}개-{YYYYMMDD}.zip`
- 같은 칸에서 이름이 겹치면 `이름 (2).md`로 번호를 붙여 덮어쓰기를 막는다
- 휴지통(deleted_at) 파일과 디스크에서 원본이 사라진 바이너리는 제외한다

**에러**
| 코드 | HTTP | 설명 |
|---|---|---|
| VALIDATION_ERROR | 400 | id 목록 형식 오류, 개수 초과, 대상 없음 |
| NOT_FOUND | 404 | 담을 수 있는 파일이 하나도 없음 (권한 없는 id만 요청한 경우 포함) |
| PAYLOAD_TOO_LARGE | 413 | 한 번에 10,000개 초과 |

---

## API-034: 본문 저장

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | PUT /files/{id}/content |
| 설명 | 단일 트랜잭션으로 (1) 기존 본문을 file_versions에 스냅샷 (2) 본문·크기 갱신 (3) 20개 초과 버전 삭제 (4) FTS 인덱스 갱신 |
| 인증 필요 | 예 (소유자 또는 관리자. 공유 열람자는 403) |

### Request
**Body**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| content | string | Y | 새 본문 전체 |
| baseUpdatedAt | number | Y | 편집 시작 시점의 updatedAt. 서버 값과 다르면 충돌로 거부 (다른 기기에서 수정된 경우) |

### Response
**200 OK** — `{ "updatedAt": 1765600000000, "versionId": 42 }`

**에러**
| 코드 | HTTP | 설명 |
|---|---|---|
| EDIT_CONFLICT | 409 | baseUpdatedAt 불일치. 클라이언트는 새 본문을 받아 병합 안내 |

---

## API-013: 사용자 생성

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | POST /admin/users |
| 설명 | 관리자가 계정 발급. 초기 비밀번호는 관리자가 지정하며 사용자는 로그인 후 변경 가능 |
| 인증 필요 | 예 (관리자) |

### Request
**Body**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| username | string | Y | 3~32자, 영소문자·숫자·언더스코어 |
| password | string | Y | 8자 이상 |
| displayName | string | N | 표시 이름 |
| role | string | N | user(기본) 또는 admin |

### Response
**201 Created** — 생성된 사용자 메타 (password 제외)

**에러**: CONFLICT 409 (username 중복)

---

## API-043: 버전 복원

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | POST /files/{id}/versions/{vid}/restore |
| 설명 | 복원도 하나의 편집으로 취급 — 현재 본문을 먼저 스냅샷한 뒤 해당 버전 내용으로 교체 (복원 전 상태로 되돌아갈 수 있음) |
| 인증 필요 | 예 (소유자 또는 관리자) |

### Response
**200 OK** — API-034와 동일 형태

---

## API-073: 파일 상태 저장

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | PUT /me/files/{id}/state |
| 설명 | 즐겨찾기 토글, 읽던 위치, 열람 기록, 화면 맞춤 여부를 부분 갱신(upsert). 뷰어가 스크롤 시 디바운스(2초)로 호출 |
| 인증 필요 | 예 |

### Request
**Body** (모두 선택 — 보낸 필드만 갱신)
| 필드 | 타입 | 설명 |
|---|---|---|
| isFavorite | boolean | 즐겨찾기 여부 |
| readingPosition | object | { anchor: "헤딩 slug", offset: number, ratio: number } — ratio(0~1)는 전체 스크롤 대비 비율. px 오프셋은 기기마다 문서 높이가 달라, 기기 간 이어 읽기는 ratio를 우선한다 |
| touch | boolean | true면 last_opened_at을 현재 시각으로 (열람 기록) |
| viewerFit | boolean | HTML 뷰어의 화면 맞춤 보정 사용 여부 (기본 true) |
| fontScale | number \| null | 이 파일만의 글자 크기 배율(%, 10~300). **null을 보내면 파일별 값을 지우고 전역 기본값을 따른다** |

### Response
**200 OK** — 갱신된 state 객체

---

## API-075: 파일 상태 조회

| 항목 | 내용 |
|---|---|
| 메서드 / 경로 | GET /me/files/{id}/state |
| 설명 | 이 파일에 대한 내 최신 열람 상태(읽던 위치·배율·맞춤·즐겨찾기) 조회. 뷰어가 문서를 열 때마다 호출 — 트리(API-021)의 state는 앱 시작 시점 캐시라, 재방문·기기 간 이어 읽기의 복원 기준은 이 조회다 |
| 인증 필요 | 예 (열람 가능한 파일만) |

### Response
**200 OK** — state 객체 (행이 없으면 기본값)

---

## API-092 / API-093: 구글 계정 연결

연결은 **두 번의 왕복**입니다. ① 앱이 동의 화면 주소를 만들어 주고(092), 사용자가 구글에서 허락하면 ② 구글이 우리 서버로 돌려보냅니다(093).

### API-092 Request

```
POST /api/v1/google/connect
```

### API-092 Response

```json
{ "authUrl": "https://accounts.google.com/o/oauth2/v2/auth?client_id=...&state=..." }
```

- `state`는 서버가 만든 일회용 난수이며 **로그인한 사용자 ID와 묶어** 서버에 보관합니다(10분). 093에서 돌려받은 state가 그 사용자의 것이 아니면 거부합니다 — 남이 자기 구글 계정을 내 docvault 계정에 붙이는 **로그인 CSRF** 방어입니다.
- 요청 파라미터에 `access_type=offline`(refresh token 발급)과 `prompt=consent`를 포함합니다. 재연결 시에도 refresh token을 확실히 받기 위함입니다 — 구글은 이미 동의한 앱에는 refresh token을 다시 주지 않습니다.
- 권한 범위는 `drive.file` + `openid email` 뿐입니다. 이유는 ERD의 "구글 드라이브 연동" 항목 참조.

### API-093 Request

```
GET /api/v1/google/callback?code=...&state=...
```

구글이 브라우저를 이 주소로 되돌려 보냅니다. 서버는 code를 토큰으로 교환하고 GOOGLE_ACCOUNTS에 저장한 뒤, **작은 HTML 한 장**을 응답해 창을 닫습니다(팝업으로 열었으므로). JSON을 응답하지 않는 유일한 API입니다.

### 에러

| 상황 | 처리 |
|---|---|
| state 불일치·만료 | 400 VALIDATION_ERROR, 창에 "다시 시도해 주세요" |
| 사용자가 동의 거부 | 창만 닫고 연결 상태 변화 없음 |
| refresh token 미발급 | 502 GOOGLE_ERROR — 구글 계정 설정에서 기존 권한을 지우고 재시도하도록 안내 |

---

## API-095: 피커 구동 정보

```
GET /api/v1/google/picker
```

### Response

```json
{
  "clientId": "...apps.googleusercontent.com",
  "appId": "123456789012",
  "accessToken": "ya29....",
  "expiresAt": 1789000000000
}
```

- `accessToken`은 **브라우저로 내려가는 유일한 구글 토큰**입니다. 피커가 구글에 직접 말을 걸어야 하므로 불가피하며, 수명이 짧고(1시간) `drive.file` 범위뿐입니다. **refresh token은 어떤 경우에도 내려보내지 않습니다.**
- 만료되었으면 서버가 refresh로 갱신한 뒤 새 토큰을 담아 줍니다.

---

## API-098: 드라이브 문서 본문 조회

```
GET /api/v1/google/files/{driveFileId}/content
```

### Response

```json
{
  "driveFileId": "1AbC...",
  "name": "설계 메모",
  "fileType": "md",
  "mimeType": "text/markdown",
  "sizeBytes": 20480,
  "modifiedAt": 1789000000000,
  "content": "# 설계 메모
..."
}
```

- 서버가 대신 읽어 옵니다(프록시). 브라우저가 구글에 직접 요청하지 않는 이유는 ① 토큰을 오래 들고 있지 않게 하고 ② 구글 문서 형식 변환을 서버에서 처리하며 ③ 뷰어가 이미 `/api/v1` 한 통로로만 본문을 읽는 구조이기 때문입니다.
- **형식 변환**: 구글 문서(`application/vnd.google-apps.document`)는 export로 마크다운을 받아 `md`로, 스프레드시트는 CSV를 받아 `code`로 다룹니다. 그 밖의 구글 전용 형식(프레젠테이션 등)은 PDF로 export해 API-099로 넘깁니다. 일반 파일은 원본을 그대로 읽어 기존 `filetypes.ts` 분류를 그대로 태웁니다 — **드라이브라고 해서 형식 판정을 새로 만들지 않습니다.**
- 텍스트 크기 한도는 기존 텍스트 파일과 같은 상수(10MB)를 씁니다. 넘으면 413 PAYLOAD_TOO_LARGE.
- 호출 성공 시 DRIVE_RECENTS에 이름·형식과 함께 열람 시각을 기록합니다(본문은 저장하지 않습니다).
- 미연결이면 409 GOOGLE_NOT_CONNECTED, 구글이 404/403을 주면 그대로 404 NOT_FOUND로 접습니다(공유 파일 정책과 같은 이유 — 존재 여부를 알려주지 않습니다).

---

## API-017 / API-018 / API-019: 자동 백업

### API-017 Response

```json
{
  "enabled": true,
  "hour": 4,
  "keepCount": 7,
  "connectedEmail": "me@gmail.com",
  "lastRunAt": 1789000000000,
  "lastStatus": "ok",
  "lastMessage": "docvault-20260916-0400.tar.gz (12.4MB) 업로드 완료"
}
```

### API-018 Request

```json
{ "enabled": true, "hour": 4, "keepCount": 7 }
```

- `enabled`를 켜려면 **호출한 관리자에게 연결된 구글 계정이 있어야** 합니다. 없으면 409 GOOGLE_NOT_CONNECTED — 토큰 없이 켜 두면 매일 조용히 실패하기 때문입니다.
- 켜는 순간 BACKUP_SETTINGS.run_by에 그 관리자의 id가 기록됩니다.

### API-019

즉시 1회 실행하고 결과(API-017과 같은 형태)를 돌려줍니다. 설정 화면에서 **"진짜 되는지" 확인하는 용도**입니다 — 매일 새벽에만 도는 기능은 처음 한 번을 눈으로 못 보면 켠 줄 알고 안 켜져 있게 됩니다.


## API-101 ~ API-106: 질문 (배움 카드 1판)

설계 전문은 [배움카드_docvault_20260918.md](배움카드_docvault_20260918.md). LLM 호출은 서버만 한다 — 키는 env `ANTHROPIC_API_KEY`, 클라이언트는 이 API만 부른다.

### API-101 Response — GET /ask/status
```json
{ "configured": true, "limit": 30, "used": 7, "remaining": 23 }
```
`configured=false`면 키가 없는 것. 나머지 API는 503 ASK_NOT_CONFIGURED. **관리자는 한도가 없다** — `limit`·`remaining`이 `null`로 온다 (키를 넣고 요금을 내는 사람이 자기를 막을 이유가 없다).

### API-102 Request — POST /ask/threads
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| fileId | number | N | 읽던 문서. 열람 권한이 있어야 한다(없으면 404). 없으면 문맥 없는 대화(G) |
| quote | string | N | 드래그한 문장 (≤500자). 출처 인용이 된다 |
| context | string | N | 선택 문장 앞뒤 문단 (≤1500자). **문서 전체가 아니라 이것만 LLM에 간다** |

**201** — `{ "thread": { id, fileId, fileName, quote, title, createdAt, updatedAt } }`. title은 첫 질문이 오면 그 앞 60자로 채워진다(그 전엔 quote 또는 "새 대화").

### API-103 — POST /ask/threads/{id}/messages
**Body** `{ "question": string(1~2000), "quote"?: string(≤500) }` — quote는 대화 중 문서에서 다시 드래그한 문장. 저장되는 user 메시지는 `「quote」\n\n question` 꼴.

한도 검사는 스트림을 열기 **전**에 한다(429는 보통 JSON 응답). 통과하면 user 메시지를 먼저 저장하고 `text/event-stream`으로 답한다:

| event | data | 언제 |
|---|---|---|
| meta | `{ "userMessageId", "remaining" }` | 첫 이벤트 |
| delta | `{ "text" }` | 토큰 조각마다 |
| searching | `{ "tool": "web_search" }` | 모델이 웹 검색을 시작했을 때 (답당 최대 3회). 화면은 "찾는 중"을 보여 준다 |
| done | `{ "assistantMessageId", "content" }` | 답이 끝나 저장된 뒤. 검색했으면 content 끝에 `🌐 참고한 곳: [제목](url) · …`가 md로 붙어 있다 (별도 칸 없음 — 저장·표시·복사가 본문 하나로) |
| error | `{ "code", "message" }` | LLM 실패. assistant 메시지는 저장하지 않는다(질문만 남음) |

첫 메시지일 때만 문맥(문서 이름·quote·context)을 user 메시지 앞에 인용으로 붙여 보낸다. 이후는 대화 이력 + 새 질문. 문맥은 system이 아니라 user 턴 안의 인용이다(문서가 LLM에게 지시하는 글을 담고 있어도 역할을 못 바꾸게).

### API-104 Response — GET /ask/threads?limit=20
`{ "threads": [ { id, fileId, fileName, quote, title, messageCount, updatedAt } ] }` — 최근 갱신순. 30일 지난 대화는 서버가 정리해 여기 없다.

### API-105 Response — GET /ask/threads/{id}
`{ "thread": {...}, "messages": [ { id, role: "user"|"assistant", content, createdAt } ] }`

## API-111 ~ API-121: 배움 카드 (2판)

설계: [배움카드_docvault_20260918.md](배움카드_docvault_20260918.md) "카드의 모양". 카드는 files의 md(kind='card')라 본문 조회·편집·버전·태그·공유는 파일 API를 그대로 쓴다. 여기는 **머리말을 아는** API만.

### API-112 Request — POST /cards/draft
`{ "threadId": number, "messageId"?: number, "messageIds"?: number[](≤30) }` — messageId면 그 답 + 바로 앞 질문만(개념 하나), messageIds면 고른 답들 + 각각의 앞 질문, 둘 다 없으면 대화 전체. 답 하나가 아니면 "여럿을 아우르는 한 장"으로 초안을 짠다. 둘을 같이 주면 400.

**200** — `{ "draft": { title, oneLine, aliases[], kind, topic, tags[], links[], body, similar: { cardId, relation: "same"|"aspect"|"related"|"different", reason, recommendation: "merge"|"link"|"new" } | null }, "similarCard": 카드 요약 | null, "source": "문서 · 인용 (대화 #id)" }`
제목·별칭이 정확히 같은 카드가 있으면 LLM 판단과 무관하게 `similar.relation = "same"`으로 채운다.

### API-113 Request — POST /cards/merge-preview
`{ "cardId", "threadId", "instruction"?: string(≤300) }` → **200** `{ "merged": { oneLine, aliases, kind, tags, links, body, changes: string[] }, "current": { title, front, body }, "source" }`. 덧붙이기가 아니라 통째로 다시 짠 본문이다.

### API-114 Request — POST /cards
`{ "title"(1~80), "oneLine"(1~120), "aliases"?, "kind"?, "topic"?, "tags"?, "links"?, "body"?(≤20000), "threadId"? }` → **201** `{ "card": 요약 }`. threadId가 있으면 출처 한 줄이 붙고 card_threads에 잇는다. 이름의 경로 문자는 제거, 겹치면 `(2)`.

### API-115 Request — PUT /cards/{id}
API-114와 같은 필드(제목 제외). 기존 출처는 유지하고 threadId의 출처를 더한다. 편집기 저장(API-034)과 같은 스냅샷 규칙.

### API-116 — GET /cards/outline?threadId=
**200** `{ "outline": null | { items[], topic, source, outlineAt, stale } }` — 대화에 저장된 정리 결과. `stale`은 정리 뒤에 대화에 답이 붙었다는 뜻(대화 updatedAt > outlineAt). 클라이언트는 창을 열 때 이것부터 보고, 있으면 LLM을 부르지 않는다.

### API-116 — POST /cards/outline (1단계)
`{ "threadId" }` → **200** 위와 같은 모양. 개념 목록(제목·한 줄·별칭·종류·주제·태그·연결·existingCardId)과 주제 카드 초안만 — **본문은 비어 있고 `ready: false`**. CARD.MODEL(빠른 모델)·effort low·출력 3000토큰이라 몇 초. 결과는 `ask_threads.outline_json`에 저장되고 이전 결과는 덮인다. 개념은 최대 8개, `existingCardId`는 LLM 판단 + 제목·별칭 정확 일치.

### API-121 — POST /cards/outline/item (2단계)
`{ "threadId", "title" }` → **200** `{ "item": { concept(body 채워짐), existing, merged, ready: true } }`. 저장된 정리에서 제목이 같은 항목을 찾아, 새 카드면 본문 초안을, 이어쓰기면 재구성(API-113과 같은 호출)을 만들어 저장된 정리에 써 넣는다. 이미 `ready`면 LLM 없이 그대로 돌려준다. 클라이언트는 목록이 뜬 뒤 항목별로 동시에 3개씩 부른다. 저장된 정리에 없는 제목이면 404 — 다시 정리해야 한다.

### API-117 Request — POST /cards/batch
`{ "threadId", "items": [ API-114 필드 + "existingCardId"? ], "topic"?: { title, oneLine, body, topic?, tags? } }` — items가 비어도 topic이 있으면 된다.
**201** `{ "created": 카드 요약[], "merged": [ { "card": 요약, "versionId" } ], "topic": 요약 | null }`. 저장이 끝나면 그 대화의 정리 결과(outline_json)는 지운다. 한 트랜잭션: existingCardId가 있는 항목은 API-115 규칙(스냅샷 + 출처 더하기)으로 이어 쓰고, 나머지는 API-114 규칙으로 만든다. 주제 카드는 kind='주제', 연결 = 개념 카드 제목들이고, 개념 카드에도 주제 카드로 가는 연결을 더한다. 되돌리기는 클라이언트가 created·topic을 API-036(휴지통), merged를 API-043(versionId로 복원)으로 한다.

### API-118 — GET /cards/export?format=md|csv&topics=a,b
텍스트로 응답한다 (`Content-Disposition: attachment`, 같은 경로가 미리보기와 다운로드에 쓰인다). `topics`는 쉼표 목록, 없으면 전체, 주제 없음은 `-`. md는 가나다 머리(ㄱ·ㄴ·…·A·B·#)별 목록 `- **제목** (별칭) — 한 줄 · 주제`, 주제 카드는 뒤에 따로. csv는 Anki 가져오기 머리 세 줄(`#separator:;` `#html:true` `#columns:…`) + `앞면;뒷면;태그` — 뒷면은 한 줄(굵게) + 본문 앞 600자(줄바꿈은 `<br>`), 태그는 주제+태그(공백은 `_`). LLM 없음.

### API-118 — POST /cards/export
`{ "topics"?: string[] }` → **201/200** `{ "file": { id, name, fileType, updatedAt }, "updated": boolean, "count" }`. 최상위의 `용어집.md`(kind=doc)가 있으면 편집기 저장 규칙(API-034 스냅샷)으로 새로 쓰고(200), 없으면 만든다(201). 파일 하나를 계속 갱신하는 이유: 내보낼 때마다 새 파일이면 트리에 용어집이 쌓인다.

### API-119 — GET /cards/review
**200** `{ "due": [ 카드 요약 + { body, intervalDays, dueAt } ], "tomorrow": number, "total": number }`. 예정 시각 = USER_FILE_STATE.next_review_at, 없으면 카드 만든 날 + 1일. 주제 카드는 뺀다. `due`는 지난 것만 오래된 순으로 최대 20장, `tomorrow`는 지금부터 24시간 안에 예정된 장수.

### API-120 — POST /cards/{id}/review
`{ "result": "ok" | "again" }` → **200** `{ "nextReviewAt", "intervalDays" }`. again → 1일, ok → max(2, 이전×2), 상한 60일. 즐겨찾기·읽던 위치는 건드리지 않는다.
