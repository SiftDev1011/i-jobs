#!/usr/bin/env bash
# Runs once, the first time the Postgres container starts with an empty volume.
# Creates the role the API and worker use. It does not own any tables and cannot
# bypass row-level security, so one site can never read another site's rows.
set -euo pipefail

: "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set}"

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
  -v app_password="$APP_DB_PASSWORD" <<'SQL'
SELECT format('CREATE ROLE ijobs_app LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE PASSWORD %L', :'app_password')
WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'ijobs_app')
\gexec
ALTER ROLE ijobs_app SET statement_timeout = '30s';
ALTER ROLE ijobs_app SET idle_in_transaction_session_timeout = '60s';
GRANT CONNECT ON DATABASE ijobs TO ijobs_app;
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
SQL

echo "ijobs_app role ready. Migrations grant it table rights."
