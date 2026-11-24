#!/usr/bin/env bash
# The i-jobs demo in one command (GitHub Codespaces, or any computer with Docker and Node 22).
#
#   bash scripts/demo.sh                 start everything (builds the first time)
#   bash scripts/demo.sh --build         rebuild first (after pulling new code)
#   bash scripts/demo.sh --reset         wipe the demo database and start fresh
#   bash scripts/demo.sh --no-live-jobs  only the 20 demo jobs, no real ones fetched
#
# Starts Postgres and Redis (Docker), the engine (API + worker) and the web app, with demo settings:
# emails are printed here instead of sent (with their sign-in codes), payments go through a demo
# checkout where no money moves, and texts are off, as on the live site. Ctrl+C stops the apps; the
# databases keep running in Docker (docker stop ijobs-pg ijobs-redis stops them too).
#
# Optional keys go in .demo/keys.env (never committed), e.g. GROQ_API_KEY=gsk_... to read CVs and
# pasted jobs.
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$PWD
OUT=$ROOT/.demo
mkdir -p "$OUT/storage"

build=0; reset=0; live=true
for a in "$@"; do
  case $a in
    --build) build=1 ;;
    --reset) reset=1 ;;
    --no-live-jobs) live=false ;;
    -h|--help) sed -n 2,15p "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown option: $a (try --help)"; exit 1 ;;
  esac
done

say() { printf '\n\033[1;32m▸ %s\033[0m\n' "$*"; }
fail() { printf '\n\033[1;31m✗ %s\033[0m\n' "$*"; exit 1; }

command -v docker >/dev/null || fail "Docker isn't installed. In a Codespace it is; on your own computer, install Docker Desktop."
docker info >/dev/null 2>&1 || fail "Docker isn't running. Start Docker Desktop (or wait a few seconds in a new Codespace) and try again."
for port in 3000 3001; do
  if (exec 3<>"/dev/tcp/127.0.0.1/$port") 2>/dev/null; then
    fail "Something is already using port $port. Stop the engine or web app you started by hand (Ctrl+C in its terminal), then run this again."
  fi
done

# ---------------------------------------------------------------- databases
say "Starting the databases"
up() { # name, then docker run arguments
  local name=$1; shift
  if docker ps --format '{{.Names}}' | grep -qx "$name"; then return; fi
  if docker ps -a --format '{{.Names}}' | grep -qx "$name"; then docker start "$name" >/dev/null
  else docker run -d --name "$name" "$@" >/dev/null; fi
}
up ijobs-pg -p 54329:5432 -e POSTGRES_HOST_AUTH_METHOD=trust pgvector/pgvector:0.8.1-pg16
up ijobs-redis -p 63799:6379 redis:7.4-alpine
for _ in $(seq 60); do docker exec ijobs-pg pg_isready -U postgres -q 2>/dev/null && break; sleep 1; done
docker exec ijobs-pg pg_isready -U postgres -q || fail "Postgres didn't start. See: docker logs ijobs-pg"

psql_admin() { docker exec -i ijobs-pg psql -U postgres -v ON_ERROR_STOP=1 -q "$@"; }
if [ $reset = 1 ]; then
  say "Wiping the demo database"
  psql_admin -c "DROP DATABASE IF EXISTS ijobs WITH (FORCE)"
  docker exec ijobs-redis redis-cli -n 0 flushdb >/dev/null
  rm -rf "$OUT/storage"; mkdir -p "$OUT/storage"
fi
[ "$(psql_admin -tAc "SELECT 1 FROM pg_database WHERE datname = 'ijobs'")" = 1 ] || psql_admin -c "CREATE DATABASE ijobs"
[ "$(psql_admin -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app'")" = 1 ] || psql_admin -c "CREATE ROLE ijobs_app LOGIN PASSWORD 'app-dev-password' NOBYPASSRLS"

# ---------------------------------------------------------------- build
if [ ! -d node_modules ]; then say "Installing packages (first time only)"; npm ci --no-audit --no-fund; fi
if [ $build = 1 ] || [ ! -f apps/engine/dist/main.js ] || [ ! -f apps/web/.next/BUILD_ID ]; then
  say "Building the engine and the web app (a few minutes)"
  npm run build -w @ijobs/engine
  npm run build -w @ijobs/web
fi

# ---------------------------------------------------------------- data
say "Updating the database and loading the demo data"
DATABASE_URL=postgres://postgres@127.0.0.1:54329/ijobs npm run -s migrate -w @ijobs/engine -- --seed >/dev/null
psql_admin -d ijobs < db/seeds/dev/demo.sql
docker exec ijobs-redis sh -c "redis-cli -n 0 --scan --pattern 'rl:*' | xargs -r redis-cli -n 0 del" >/dev/null # sign-in rate limits

# ---------------------------------------------------------------- settings
# Secrets are made once and kept, so sign-ins survive a restart.
if [ ! -f "$OUT/secrets.env" ]; then
  printf 'JWT_SECRET=%s\nAUTH_PEPPER=%s\n' "$(openssl rand -hex 32)" "$(openssl rand -hex 32)" > "$OUT/secrets.env"
fi
set -a
. "$OUT/secrets.env"
[ -f "$OUT/keys.env" ] && . "$OUT/keys.env"
set +a

# In a Codespace, links in emails (invites, demo tours) must use its public address, not localhost.
if [ -n "${CODESPACE_NAME:-}" ]; then
  WEB_URL="https://${CODESPACE_NAME}-3001.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  API_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  export SERVER_ACTIONS_ALLOWED_ORIGINS="${SERVER_ACTIONS_ALLOWED_ORIGINS:-*.app.github.dev,localhost:3001}"
else
  WEB_URL=http://localhost:3001
  API_URL=http://localhost:3000
fi

export NODE_ENV=development PORT=3000 LOG_LEVEL=info \
  DATABASE_URL=postgres://ijobs_app:app-dev-password@127.0.0.1:54329/ijobs \
  DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:54329/ijobs \
  REDIS_URL=redis://127.0.0.1:63799/0 \
  PUBLIC_APP_URL="$WEB_URL" PUBLIC_API_URL="$API_URL" \
  MAIL_DRIVER=console SMS_DRIVER=none PAGA_DRIVER=fake \
  STORAGE_DRIVER=local STORAGE_DIR="$OUT/storage" \
  INGEST_ENABLED=$live

# ---------------------------------------------------------------- start
pids=()
stop() {
  trap - EXIT INT TERM
  printf '\n\033[1;32m▸ Stopping the demo\033[0m\n'
  [ ${#pids[@]} -gt 0 ] && kill "${pids[@]}" 2>/dev/null || true
  wait 2>/dev/null || true
  echo "  Stopped. The databases are still running; docker stop ijobs-pg ijobs-redis stops them too."
  exit 0
}
trap stop EXIT INT TERM

say "Starting the engine, the worker and the web app"
: > "$OUT/engine.log"; : > "$OUT/worker.log"; : > "$OUT/web.log"
node apps/engine/dist/main.js >> "$OUT/engine.log" 2>&1 & pids+=($!)
node apps/engine/dist/worker.js >> "$OUT/worker.log" 2>&1 & pids+=($!)
(cd apps/web && ENGINE_URL=http://localhost:3000 PUBLIC_APP_URL="$WEB_URL" exec npx next start -p 3001) >> "$OUT/web.log" 2>&1 & pids+=($!)

ready() { # url, name, log
  for _ in $(seq 90); do curl -sf -o /dev/null "$1" && return 0; sleep 1; done
  echo; tail -n 30 "$3"; fail "The $2 didn't start. Its log is above (and in $3)."
}
ready http://localhost:3000/v1/health engine "$OUT/engine.log"
ready http://localhost:3001 "web app" "$OUT/web.log"

cat <<EOF

$(printf '\033[1;32m')✓ The i-jobs demo is running$(printf '\033[0m')

  Open it:      $WEB_URL
                (In a Codespace: Ports tab → port 3001 → globe icon. To show it on another
                device, right-click port 3001 → Port Visibility → Public.)

  Sign in as    owner@demo.ijobs.example   the community owner (Lagos Tech Hustlers, Grad Jobs Africa)
                staff@demo.ijobs.example   the i-jobs team (Staff tools)
                any other email            a new member; join with invite code LTH-2048

  Sign-in codes and every other email appear below. Payments use a demo checkout: no money moves.
  $( [ "$live" = true ] && echo "Real jobs start arriving from job sites in about 5 minutes." || echo "Live jobs are off: only the 20 demo jobs." )
  $( [ -n "${GROQ_API_KEY:-}" ] && echo "AI is on: CVs and pasted jobs are read." || echo "No GROQ_API_KEY in .demo/keys.env: CVs and pasted jobs won't be read by AI." )

  Logs: .demo/engine.log, .demo/worker.log, .demo/web.log      Stop: Ctrl+C

EOF

# Show emails (with their codes) and errors as they happen, until Ctrl+C.
tail -n 0 -F "$OUT/engine.log" "$OUT/worker.log" 2>/dev/null | node scripts/demo-mail.mjs &
pids+=($!)
wait "${pids[0]}" || true
trap - EXIT
kill "${pids[@]}" 2>/dev/null || true
echo; tail -n 15 "$OUT/engine.log"
fail "The engine stopped. The end of its log is above."
