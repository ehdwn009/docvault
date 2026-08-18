#!/usr/bin/env bash
# docvault 업데이트 — 깃허브의 새 설정과 GHCR의 새 이미지를 받아 컨테이너를 교체한다.
# 서버에서 실행한다. 어느 폴더에서 불러도 되도록 스스로 저장소 루트로 이동한다.
# 사용: ~/docvault/scripts/update.sh
# 원격에서: ssh 계정@호스트 '~/docvault/scripts/update.sh'
# cron 예: */10 * * * * ~/docvault/scripts/update.sh >> ~/update.log 2>&1
#   (이미지가 그대로면 up -d는 아무것도 바꾸지 않으므로 주기 실행이 안전하다)
set -euo pipefail
cd "$(dirname "$0")/.."

# edge 프로파일을 빼면 compose가 Caddy(HTTPS 담당)를 내려버린다
PROFILE="${DOCVAULT_PROFILE:-edge}"

echo "[$(date '+%F %T')] update 시작 (profile=$PROFILE)"
git pull
docker compose --profile "$PROFILE" pull
docker compose --profile "$PROFILE" up -d
docker image prune -f >/dev/null   # 교체 후 남은 옛 이미지 정리 (작은 디스크 보호)
echo "[$(date '+%F %T')] update 완료"
docker compose ps
