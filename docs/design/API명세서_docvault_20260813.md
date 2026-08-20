# API 명세서: docvault

| 작성자 | | 작성일 | 2026-08-13 | 버전 | v0.1 | Base URL | /api/v1 (동일 오리진) |

## 공통 규약

- **인증**: 로그인 성공 시 JWT를 httpOnly 쿠키 `dv_session`으로 발급 (유효기간 7일, SameSite=Lax, 배포 시 Secure). 이후 모든 요청은 쿠키로 자동 인증되며 Authorization 헤더를 사용하지 않습니다.
- **권한 등급**: 공개(로그인 불필요) 없음 — 로그인 화면 외 전 API가 인증 필수. `관리자` 표시 API는 role=admin만 호출 가능.
- **파일 접근 규칙**: 소유자 본인, is_shared=1인 파일(및 공유 폴더 하위 파일)의 열람, 관리자는 전체 접근. 공유 파일은 열람 전용(수정 불가).
- **공통 에러 응답**: `{ "code": "ERROR_CODE", "message": "설명" }`

| 코드 | HTTP | 의미 |
|---|---|---|
| VALIDATION_ERROR | 400 | 입력값 오류 (zod 검증 실패) |
| UNAUTHORIZED | 401 | 미로그인 / 세션 만료 |
| FORBIDDEN | 403 | 권한 없음 (관리자 전용, 비활성 계정, **열람은 되지만 수정 권한이 없는 경우**) |
| TOO_MANY_ATTEMPTS | 429 | 로그인 시도 초과 (Retry-After 헤더에 대기 초) |
| NOT_FOUND | 404 | 대상 없음, **또는 열람 권한이 없는 자원** (403은 존재를 알려 주므로 통일 — 정보 노출 방지) |
| CONFLICT | 409 | 중복 (username, 같은 폴더 내 동일 이름 등) |
| PAYLOAD_TOO_LARGE | 413 | 업로드 크기 초과 |

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
| API-072 | PUT | /me/settings | 뷰어 설정 저장 (테마·글자 크기·HTML 글자 배율·본문 너비) | 로그인 |
| API-073 | PUT | /me/files/{id}/state | 즐겨찾기·읽던 위치·열람 기록·화면 맞춤 저장 | 로그인 |
| API-074 | GET | /me/recent | 최근 열람 파일 목록 | 로그인 |
| API-081 | GET | /search?q= | 파일명+본문 전문 검색 (FTS5) | 로그인 |

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
| 설명 | 확장자·MIME 화이트리스트 검사 → 텍스트 계열은 본문을 DB에, 바이너리는 디스크에 저장. 여러 파일 동시 업로드 지원 |
| 인증 필요 | 예 |

### Request
**Body (multipart)**
| 필드 | 타입 | 필수 | 설명 |
|---|---|---|---|
| files | File[] | Y | 업로드 파일 (v1 허용: .md .markdown .html .txt / 로드맵: 코드·이미지·PDF) |
| folderId | number | N | 대상 폴더. 생략 시 루트 |

### Response
**201 Created**
| 필드 | 타입 | 설명 |
|---|---|---|
| files | array | 생성된 파일 메타 목록 (API-021의 files 항목과 동일 형태) |

**에러**
| 코드 | HTTP | 설명 |
|---|---|---|
| UNSUPPORTED_TYPE | 400 | 허용되지 않는 확장자/MIME |
| PAYLOAD_TOO_LARGE | 413 | 파일당 크기 제한 초과 (텍스트 10MB, 추후 바이너리 50MB) |

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
| readingPosition | object | { anchor: "헤딩 slug", offset: number } |
| touch | boolean | true면 last_opened_at을 현재 시각으로 (열람 기록) |
| viewerFit | boolean | HTML 뷰어의 화면 맞춤 보정 사용 여부 (기본 true) |
| fontScale | number \| null | 이 파일만의 글자 크기 배율(%, 10~300). **null을 보내면 파일별 값을 지우고 전역 기본값을 따른다** |

### Response
**200 OK** — 갱신된 state 객체
