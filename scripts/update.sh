#!/usr/bin/env bash
# docvault 업데이트 — 깃허브의 새 설정과 GHCR의 새 이미지를 받아 컨테이너를 교체한다.
# 서버에서 실행한다. 어느 폴더에서 불러도 되도록 스스로 저장소 루트로 이동한다.
# 사용: ~/docvault/scripts/update.sh
# 원격에서: ssh 계정@호스트 '~/docvault/scripts/update.sh'
# cron 예: */10 * * * * ~/docvault/scripts/update.sh >> ~/update.log 2>&1
#   (이미지가 그대로면 up -d는 아무것도 바꾸지 않으므로 주기 실행이 안전하다)
set -euo pipefail

# edge 프로파일을 빼면 compose가 Caddy(HTTPS 담당)를 내려버린다
PROFILE="${DOCVAULT_PROFILE:-edge}"

# 뉴스 브리핑이 만들어지는 중인가 — 그때 컨테이너를 갈아 끼우면 그 실행이 "서버 재시작으로 중단"으로 끝난다.
# 앱 컨테이너 안의 DB를 읽기 전용으로 본다. 물어볼 수 없으면(컨테이너가 꺼져 있는 등) 도는 중이 아니라고 본다
briefing_running() {
  local n
  n=$(docker compose exec -T app node -e "
    const db = new (require('better-sqlite3'))('data/docvault.db', { readonly: true });
    console.log(db.prepare(\"select count(*) as n from briefing_runs where status = 'running'\").get().n);
  " 2>/dev/null) || return 1
  [ "${n:-0}" -gt 0 ]
}

# 본문을 함수로 감싼다 — git pull이 이 파일 자체를 바꿔도, bash는 이미 다 읽은 함수를 실행하므로 중간에 꼬이지 않는다
main() {
  cd "$(dirname "$0")/.."
  echo "[$(date '+%F %T')] update 시작 (profile=$PROFILE)"
  git pull --quiet
  docker compose --profile "$PROFILE" pull --quiet
  if briefing_running; then
    # 받아 둔 이미지는 그대로 두고, 교체만 다음 차례(cron이면 10분 뒤)로 미룬다
    echo "[$(date '+%F %T')] 브리핑을 만드는 중 — 교체는 다음 차례에"
    return 0
  fi
  docker compose --profile "$PROFILE" up -d
  docker image prune -f >/dev/null   # 교체 후 남은 옛 이미지 정리 (작은 디스크 보호)
  echo "[$(date '+%F %T')] update 완료"
  docker compose ps
}

main "$@"
