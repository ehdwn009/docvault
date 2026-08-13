# docvault 배포 가이드 (빠른 참조)

`docker compose up` 하나로 어디서든 동일하게 실행되는 것이 설계 원칙이다. 이 문서는 명령어 위주 요약이며, **처음이라면 [배포-완전-가이드.md](배포-완전-가이드.md)** (계정 가입·설치부터 단계별 안내)를 보는 것을 권한다.

## 0. 준비물

- Docker + Docker Compose가 설치된 리눅스 서버 (Oracle Cloud 무료 VPS, GCP e2-micro, 집 서버, 라즈베리파이 등)
- 외부(폰 LTE)에서 접속하려면: 무료 Cloudflare 계정 (터널 방식 — 포트포워딩·고정IP·인증서 불필요)

## 1. 서버에 올리기

```bash
# 1) 코드 받기
git clone https://github.com/ehdwn009/docvault.git
cd docvault

# 2) 환경변수 설정
cp .env.example .env
# .env를 열어 JWT_SECRET을 긴 무작위 문자열로 교체 (필수!)
#   생성 예: openssl rand -hex 32
# ADMIN_INITIAL_PASSWORD도 바꿔두면 좋다

# 3) 빌드 + 실행
docker compose up -d --build

# 4) 확인
curl http://localhost:3000/api/v1/health   # {"status":"ok",...}
```

브라우저에서 `http://서버IP:3000` 접속 → admin / (설정한 초기 비밀번호) 로그인 → **설정에서 비밀번호부터 변경**.

같은 공유기 안에서만 쓸 거라면 여기서 끝. 폰 홈 화면 추가(PWA)는 `http://내부IP:3000`을 열고 "홈 화면에 추가".

## 2. 외부 접속 — Cloudflare Tunnel (선택)

포트를 하나도 열지 않고 HTTPS 주소를 얻는 방법. 도메인이 있으면 내 도메인으로, 없으면 Cloudflare 대시보드에서 무료로 연결한다.

1. [Cloudflare Zero Trust](https://one.dash.cloudflare.com) → Networks → Tunnels → **Create a tunnel** (Cloudflared 방식)
2. 터널 이름 입력 후, 표시되는 **토큰**(`eyJ...`)을 복사
3. Public Hostname 추가: 원하는 주소 → Service `http://app:3000`
   (터널 컨테이너가 compose 네트워크 안에서 앱을 `app`이라는 이름으로 찾는다)
4. 서버의 `.env`에 붙여넣기: `CLOUDFLARE_TUNNEL_TOKEN=eyJ...`
5. 터널 프로필을 켜서 재기동:

```bash
docker compose --profile tunnel up -d
```

이후 `https://내주소`로 어디서든 접속. HTTPS라서 PWA 설치·쿠키 모두 정상 동작한다.

## 3. 업데이트

```bash
git pull
docker compose up -d --build     # 데이터(data/)는 그대로 유지된다
```

DB 스키마 변경이 있어도 서버가 기동하면서 마이그레이션을 자동 적용한다.

## 4. 백업 / 복원 / 이사

영속 데이터는 `data/` 폴더 하나가 전부다 (SQLite + 바이너리 원본).

```bash
# 수동 백업 (앱을 수 초 멈추고 일관된 스냅샷을 뜬다)
./scripts/backup.sh

# 매일 새벽 4시 자동 백업 (crontab -e)
0 4 * * * cd /path/to/docvault && ./scripts/backup.sh >> backup.log 2>&1

# 복원 / 다른 서버로 이사
docker compose down
tar -xzf backups/docvault-YYYYMMDD-HHMMSS.tar.gz   # data/ 복원
docker compose up -d --build
```

백업 파일을 다른 곳(구글드라이브 등)에도 두고 싶으면 rclone을 얹으면 된다:
`rclone copy backups/ gdrive:docvault-backups`

## 5. 문제 해결

| 증상 | 확인 |
|---|---|
| 컨테이너가 안 뜸 | `docker compose logs app` — JWT_SECRET 미설정이 흔한 원인 |
| 로그인이 자꾸 풀림 | JWT_SECRET이 재기동마다 바뀌는지 확인 (.env에 고정해야 함) |
| 터널 연결 안 됨 | `docker compose logs tunnel` — 토큰 확인. Public Hostname의 Service가 `http://app:3000`인지 확인 |
| 헬스체크 | `docker inspect --format='{{.State.Health.Status}}' docvault-app-1` |
