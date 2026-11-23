#!/usr/bin/env bash
# Nightly database backup to Cloudflare R2 (free up to 10 GB).
# Install with: crontab -e  →  17 2 * * * /opt/ijobs/infra/scripts/backup.sh >> /var/log/ijobs-backup.log 2>&1
#
# Needs rclone with a remote called "r2" (setup-server.sh installs rclone; see infra/README.md),
# ideally wrapped in an rclone "crypt" remote so backups are encrypted before they leave the server.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${BACKUP_REMOTE:-r2-crypt:ijobs-backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
STAMP="$(date -u +%Y-%m-%dT%H%MZ)"
NAME="ijobs-${STAMP}.dump"

cd "$ROOT"
echo "[$(date -u +%FT%TZ)] backup start → ${REMOTE}/${NAME}"

# Custom format: compressed, and restores table by table.
docker compose -f docker-compose.yml --env-file .env exec -T postgres \
  pg_dump -U postgres -d ijobs --format=custom --compress=6 --no-owner \
  | rclone rcat "${REMOTE}/daily/${NAME}"

# Keep one backup a month for a year.
if [ "$(date -u +%d)" = "01" ]; then
  rclone copyto "${REMOTE}/daily/${NAME}" "${REMOTE}/monthly/${NAME}"
  rclone delete "${REMOTE}/monthly" --min-age 366d
fi

rclone delete "${REMOTE}/daily" --min-age "${KEEP_DAYS}d"
SIZE="$(rclone size "${REMOTE}/daily/${NAME}" --json | sed -E 's/.*"bytes":([0-9]+).*/\1/')"
if [ "${SIZE:-0}" -lt 10000 ]; then
  echo "Backup looks too small (${SIZE} bytes). Check it." >&2
  exit 1
fi
echo "[$(date -u +%FT%TZ)] backup done (${SIZE} bytes)"
