# ERD: docvault

| 작성자 | | 작성일 | 2026-08-13 | 버전 | v0.1 |

## 엔티티 다이어그램

```mermaid
erDiagram
    USERS ||--o{ FOLDERS : "소유한다"
    USERS ||--o{ FILES : "소유한다"
    USERS ||--o{ TAGS : "소유한다"
    USERS ||--o{ FILE_VERSIONS : "저장한다"
    USERS ||--o{ USER_FILE_STATE : "가진다"
    USERS ||--|| USER_SETTINGS : "가진다"
    FOLDERS ||--o{ FOLDERS : "하위 폴더"
    FOLDERS ||--o{ FILES : "담는다"
    FILES ||--o{ FILE_VERSIONS : "스냅샷"
    FILES ||--o{ FILE_TAGS : "부착된다"
    TAGS ||--o{ FILE_TAGS : "부착한다"
    FILES ||--o{ USER_FILE_STATE : "상태 대상"

    USERS {
        integer id PK
        text username UK "로그인 ID"
        text password_hash "bcrypt"
        text display_name
        text role "user | admin"
        integer is_active "0|1"
        integer created_at "unix ms"
        integer updated_at
        integer last_signed_in
        integer session_epoch "이 시각 이전 발급 토큰은 무효 (비밀번호 변경 시 갱신)"
    }
    FOLDERS {
        integer id PK
        integer owner_id FK
        integer parent_id FK "null=루트, 자기참조"
        text name
        integer is_shared "0|1 관리자가 토글"
        integer sort_order
        integer created_at
        integer updated_at
    }
    FILES {
        integer id PK
        integer owner_id FK
        integer folder_id FK "null=루트"
        text name
        text file_type "md|html|code|text|image|pdf|audio|video|binary (2026-08-27)"
        text mime_type
        integer size_bytes
        text content_text "텍스트 계열만, 바이너리는 null"
        text storage_path "바이너리만, 텍스트는 null"
        integer is_shared "0|1"
        integer sort_order
        integer deleted_at "휴지통 이동 시각, null=정상 (2026-08-15)"
        integer created_at
        integer updated_at
    }
    FILE_VERSIONS {
        integer id PK
        integer file_id FK
        integer saved_by FK "users.id"
        text content_text
        integer size_bytes
        integer created_at
    }
    TAGS {
        integer id PK
        integer owner_id FK
        text name
        text color "hex"
        integer created_at
    }
    FILE_TAGS {
        integer file_id PK, FK
        integer tag_id PK, FK
    }
    USER_FILE_STATE {
        integer user_id PK, FK
        integer file_id PK, FK
        integer is_favorite "0|1"
        text reading_position "스크롤/헤딩 앵커 JSON"
        integer last_opened_at "최근 열람 정렬용"
        integer viewer_fit "0|1 화면 맞춤 보정(기본 1)"
        integer font_scale "이 파일만의 글자 배율(%), NULL이면 전역"
    }
    USER_SETTINGS {
        integer user_id PK, FK
        text viewer_theme "light|sepia|green|gray|dark|night"
        integer font_size "md 본문 절대 크기(px)"
        integer html_font_scale "HTML 글자 배율 전역 기본(%)"
        text font_family
        text line_height
        text content_width "narrow|normal|wide"
        text last_seen_version "마지막으로 확인한 앱 버전, 패치노트 모달용 (2026-08-14)"
        integer updated_at
    }
```

## 엔티티 설명

| 엔티티 | 설명 |
|---|---|
| USERS | 관리자가 발급하는 로컬 계정. 회원가입 경로 없음. 초기 시드로 admin 계정 1개 생성. `session_epoch`는 발급된 세션 토큰을 한꺼번에 무효화하는 장치 — 토큰이 담고 온 값과 다르면 거부한다 |
| FOLDERS | 사용자별 폴더 트리. parent_id 자기참조로 무제한 중첩 |
| FILES | 파일 메타데이터 + 텍스트 본문. 바이너리는 storage_path로 디스크 참조. file_type은 저장·렌더링 방식을 결정: md/html/code/text는 텍스트(DB 본문), image/pdf/audio/video/binary는 바이너리(디스크) |
| FILE_VERSIONS | 편집 저장 시점의 본문 스냅샷. 파일당 최근 20개 유지 |
| TAGS | 사용자별 색상 태그 |
| FILE_TAGS | 파일-태그 다대다 연결 (복합 PK) |
| USER_FILE_STATE | 사용자×파일별 상태: 즐겨찾기, 읽던 위치, 최근 열람, 화면 맞춤 여부. 기기 간 동기화의 핵심 |
| USER_SETTINGS | 뷰어 설정(테마·폰트 등). 서버 저장으로 폰/PC 동일 설정 유지 |

## 관계 설명

- 사용자 1명은 폴더·파일·태그를 여러 개 소유합니다. 삭제 정책: 사용자 삭제 시 소유 데이터 전체 CASCADE 삭제.
- 폴더는 자기참조(parent_id)로 트리를 구성합니다. 폴더 삭제 시 하위 폴더는 CASCADE 삭제되고, 안의 파일은 folder_id를 끊고 휴지통으로 이동합니다 (2026-08-15 휴지통 도입).
- **휴지통 (2026-08-15)**: FILES.deleted_at(nullable)로 soft delete. null이면 정상, 값이 있으면 휴지통. 휴지통 파일은 모든 목록·검색·접근에서 제외되며(복원·영구삭제 라우트만 예외), 30일 경과 시 서버가 자동 영구 삭제(기동 시 + 일 1회). 휴지통의 파일은 이름을 점유하지 않고, 복원 시 충돌하면 "이름 (2)" 형식으로 자동 개명, 원 폴더가 사라졌으면 최상위로 복원.
- 파일 1개는 버전 스냅샷 여러 개를 가지며, 저장 시 20개 초과분은 오래된 것부터 삭제.
- **화면 맞춤 (2026-08-18)**: viewer_fit은 뷰어가 HTML 문서를 좁은 화면에 맞게 보정할지 여부입니다(기본 1=켬). 문서가 아니라 "이 사람이 이 문서를 어떻게 볼지"의 선택이므로 FILES가 아니라 USER_FILE_STATE에 둡니다 — 같은 공유 문서를 A는 보정해서, B는 원본으로 볼 수 있습니다.
- **글자 크기 2층 구조 (2026-08-18)**: HTML 글자 크기는 USER_SETTINGS.html_font_scale(전역 기본 배율)과 USER_FILE_STATE.font_scale(이 파일만의 배율)로 나뉩니다. font_scale이 **NULL이면 전역을 따르고**, 값이 있으면 그것으로 **대체**합니다(곱하지 않습니다). NULL을 "없음"으로 쓰기 때문에 대부분의 파일은 전역 설정을 바꾸면 같이 따라오고, 유별난 문서만 자기 값을 갖습니다 — 그래서 UI에는 반드시 "기본값 따르기"(= NULL로 되돌리기)가 있어야 합니다. font_scale은 형식을 가리지 않습니다 — HTML은 문서 자신의 크기를 100%로, md·텍스트는 USER_SETTINGS.font_size를 100%로 삼을 뿐 규칙은 같습니다(전역 기본 배율 html_font_scale은 HTML에만 있습니다).
- 즐겨찾기·읽던 위치는 파일 속성이 아니라 USER_FILE_STATE(사용자×파일)에 둡니다. 공유 파일을 열람하는 다른 사용자도 자신만의 즐겨찾기·읽던 위치를 가질 수 있게 하기 위한 구조입니다 (기존 Manus 버전에서 파일에 붙어 있던 isFavorite의 개선).
- 공유는 v1에서는 파일/폴더의 is_shared 플래그(전체 사용자 대상 열람 공개, 관리자만 토글)로 구현하고, 추후 특정 사용자 대상 공유가 필요해지면 SHARES(file_id, grantee_id, permission) 테이블로 확장합니다.
- **전량 수용 정책 (2026-08-27)**: 업로드는 확장자를 거절하지 않고 **분류**합니다. 아는 텍스트 확장자(md/html/코드류/txt) → 해당 타입, 모르는 확장자는 내용을 검사해(UTF-8 · NUL 없음 · 10MB 이하) 텍스트면 text, 아니면 binary. 오디오·비디오는 audio/video 타입으로 디스크 저장. binary는 미리보기 없이 보관·다운로드만 지원합니다. file_type의 enum은 Drizzle 스키마의 TS 타입 제약이며 SQLite에는 CHECK 제약을 두지 않으므로 값 추가에 마이그레이션이 필요 없습니다.

## 비고

- 타임스탬프는 전부 unix epoch 밀리초 정수(UTC)로 저장하고 표시 시점에 로컬 변환합니다.
- 전문 검색용 FTS5 가상 테이블 `files_fts(name, content_text)`는 ERD에는 표시하지 않는 파생 인덱스이며, FILES 변경 시 트리거로 동기화합니다.
- 컬럼별 상세 제약·기본값은 구현 시 테이블 정의서(데이터 사전)로 별도 문서화할 수 있습니다.
