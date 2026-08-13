#!/usr/bin/env bash
# docvault 백업 — data/ 폴더가 곧 전체 백업 단위 (아키텍처 — 백업)
# SQLite WAL 파일이 일관된 상태로 담기도록 앱을 잠깐 멈추고 압축한다 (다운타임 수 초).
# 사용: ./scripts/backup.sh [보관폴더]   (기본: ./backups)
# cron 예: 0 4 * * * cd /path/to/docvault && ./scripts/backup.sh >> backup.log 2>&1
set -euo pipefail
cd "$(dirname "$0")/.."

DEST="${1:-./backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$DEST"

docker compose stop app
tar -czf "$DEST/docvault-$STAMP.tar.gz" data
docker compose start app

# 최근 14개만 보관
ls -1t "$DEST"/docvault-*.tar.gz 2>/dev/null | tail -n +15 | xargs -r rm --
echo "backup done: $DEST/docvault-$STAMP.tar.gz"
