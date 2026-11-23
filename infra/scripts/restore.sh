#!/usr/bin/env bash
# Restores a backup from R2 into a NEW database, so the live one is untouched until you switch.
#   infra/scripts/restore.sh                       # list backups
#   infra/scripts/restore.sh daily/ijobs-2026-11-19T0217Z.dump ijobs_restore
# Then check it, and if it is right: stop api/worker, rename databases, start again (see infra/README.md).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REMOTE="${BACKUP_REMOTE:-r2-crypt:ijobs-backups}"
cd "$ROOT"

if [ $# -lt 1 ]; then
  echo "Backups in ${REMOTE}:"
  rclone lsl "${REMOTE}" | sort -k2,3
  exit 0
fi

FILE="$1"
TARGET="${2:-ijobs_restore}"
DC=(docker compose -f docker-compose.yml --env-file .env)

if [ "$TARGET" = "ijobs" ]; then
  echo "Refusing to restore over the live database. Pick another name." >&2
  exit 1
fi

"${DC[@]}" exec -T postgres psql -U postgres -v ON_ERROR_STOP=1 -c "DROP DATABASE IF EXISTS ${TARGET}" -c "CREATE DATABASE ${TARGET}"
"${DC[@]}" exec -T postgres psql -U postgres -d "${TARGET}" -c "CREATE EXTENSION IF NOT EXISTS vector" -c "CREATE EXTENSION IF NOT EXISTS pgcrypto"
rclone cat "${REMOTE}/${FILE}" | "${DC[@]}" exec -T postgres pg_restore -U postgres -d "${TARGET}" --no-owner --exit-on-error
"${DC[@]}" exec -T postgres psql -U postgres -d "${TARGET}" -c \
  "GRANT USAGE ON SCHEMA public TO ijobs_app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ijobs_app; GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ijobs_app; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ijobs_app;"
"${DC[@]}" exec -T postgres psql -U postgres -d "${TARGET}" -At -c \
  "SELECT 'users: ' || count(*) FROM users UNION ALL SELECT 'jobs: ' || count(*) FROM jobs UNION ALL SELECT 'last migration: ' || max(name) FROM schema_migrations"
echo "Restored ${FILE} into ${TARGET}."
