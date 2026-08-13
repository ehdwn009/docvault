# docvault

관리자가 계정을 발급하는 폐쇄형 문서 열람·편집 플랫폼. MD·HTML·텍스트·이미지·PDF를 올리고, 폰에서 읽던 문서를 PC에서 이어 읽는다.

- **뷰어**: 마크다운(GFM·코드 하이라이트·mermaid 다이어그램), HTML(격리 렌더링), PDF, 이미지
- **편집**: 분할 화면 에디터, 버전 20개 자동 보관·복원, 편집 충돌 감지
- **동기화**: 즐겨찾기·읽던 위치·최근 열람·뷰어 설정이 기기 간 공유 (서버 저장)
- **정리**: 폴더 트리(드래그앤드롭), 색상 태그, 전문 검색(FTS5), Ctrl+K 커맨드 팔레트
- **공유**: 관리자가 파일·폴더 단위로 전체 공개 토글
- **모바일**: 반응형 + PWA 홈 화면 설치, URL 딥링크(`/f/{id}`)

## 실행

```bash
cp .env.example .env    # JWT_SECRET 채우기
docker compose up -d --build
# → http://localhost:3000 (초기 계정 admin / admin1234 — 바로 변경할 것)
```

배포·외부 접속(Cloudflare Tunnel)·백업은 [docs/deploy.md](docs/deploy.md) 참고.

## 개발

```bash
npm install
npm run dev:server   # Hono API :3000
npm run dev:client   # Vite :5173 (/api 프록시)
```

| 스택 | |
|---|---|
| 클라이언트 | React 19, Vite, Tailwind 4, react-markdown, mermaid |
| 서버 | Node 22+, Hono, zod, jose |
| DB | SQLite (better-sqlite3, Drizzle ORM, FTS5) — 텍스트는 DB, 바이너리는 디스크 |

설계 문서는 [docs/design/](docs/design/), 개발 규칙은 [CLAUDE.md](CLAUDE.md)에 있다.
영속 데이터는 `data/` 폴더 하나 — 이 폴더 복사가 곧 백업이다.
