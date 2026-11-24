# Putting the engine on the server

The beta runs on one **Oracle Always Free Ampere** server (2 OCPU, 12 GB RAM, ARM, Ubuntu 24.04).
Everything runs in Docker:

| Service | Role | Memory (rough) |
|---|---|---|
| `postgres` | pgvector/pgvector, PostgreSQL 16 | 2 GB shared buffers, up to ~4 GB |
| `redis` | queues; never evicts, writes to disk | up to 1 GB |
| `migrate` | applies migrations + reference data, then exits | — |
| `api` | `/v1`, port 3000 on localhost only | ~250 MB |
| `worker` | background queues | ~300 MB |
| `cloudflared` | Cloudflare Tunnel: the only way in from the internet | ~50 MB |

No public ports are open except SSH. Cloudflare sits in front (TLS, DDoS protection, caching rules).

## 1. Server

```bash
scp -r infra ubuntu@<server-ip>:/tmp/infra
ssh ubuntu@<server-ip> 'sudo bash /tmp/infra/scripts/setup-server.sh && sudo mv /tmp/infra /opt/ijobs/infra'
```

`setup-server.sh` updates the system, turns on automatic security updates, closes everything but SSH,
turns off password logins, adds fail2ban, 4 GB swap, Docker and rclone. Log out and in again afterwards.
In the Oracle console, make sure the VCN security list only allows port 22 inbound.

## 2. Cloudflare Tunnel

1. Cloudflare dashboard → Zero Trust → Networks → Tunnels → **Create a tunnel** (Cloudflared).
2. Copy the token into `CLOUDFLARE_TUNNEL_TOKEN` in `infra/.env`.
3. Public hostname: `ijobs-api.remotehustle.name.ng` → service `http://api:3000`.
   (Not `api.i-jobs.…`: Cloudflare's free certificate only covers one level below `remotehustle.name.ng`.)

The tunnel container connects out to Cloudflare, so nothing listens publicly.

## 3. Settings

```bash
cd /opt/ijobs/infra
cp .env.example .env
nano .env        # fill every blank: secrets with openssl rand -base64 48, the 3 passwords with openssl rand -hex 24
chmod 600 .env
```

`ENGINE_IMAGE` is the image CI pushes: `ghcr.io/<owner>/<repo>/engine:latest`. If the repository is
private: `echo <token> | docker login ghcr.io -u <github-user> --password-stdin` (a token with
`read:packages`).

## 4. Start

```bash
docker compose up -d
docker compose ps                         # migrate should be "exited (0)", the rest "healthy"/"running"
curl -s localhost:3000/v1/health          # {"status":"ok",...}
docker compose logs -f api worker
```

First start: Postgres runs `scripts/init-db.sh` (creates the `ijobs_app` role and extensions), then
`migrate` applies the schema and reference data.

### Site keys

Each partner site (Remote Hustle, School1, the i-jobs web app) gets a key. Only its hash is stored;
the key is printed once:

```bash
docker compose run --rm -e DATABASE_URL="postgres://postgres:$(grep ^POSTGRES_PASSWORD .env | cut -d= -f2)@postgres:5432/ijobs" \
  api node dist/scripts/site-key.js remote-hustle
```

Put it in that site's server-side environment (Vercel → Settings → Environment Variables). Never in browser code.

## 5. Deploying a new version

CI pushes a new image on every merge to `main`. On the server:

```bash
cd /opt/ijobs/infra
docker compose pull && docker compose up -d
```

`migrate` runs first, then `api` and `worker` restart. The worker gets 60 seconds to finish running jobs.
To roll back, set `ENGINE_IMAGE` to an earlier `:<commit-sha>` tag and run `up -d` again. Migrations only
go forward, so a rollback across a migration needs that migration to be backwards compatible, which is
the rule for every migration we write.

## 6. CV storage (Cloudflare R2)

1. Create a private bucket `ijobs-files` (no public access) and an API token with read/write to that bucket only.
   Put its keys in `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`.
2. Browsers upload CVs straight to the bucket, so it needs a CORS rule (bucket → Settings → CORS policy):

```json
[{ "AllowedOrigins": ["https://i-jobs.remotehustle.name.ng", "https://remotehustle.plug99.com.ng"],
   "AllowedMethods": ["PUT"], "AllowedHeaders": ["content-type", "content-length"], "MaxAgeSeconds": 3600 }]
```

The upload link only accepts the exact file type and size the member declared, and expires in 15 minutes.

## 7. Email (Amazon SES + Cloudflare Email Routing)

Account email (sign-in codes, notifications) sends from `mail.i-jobs.remotehustle.name.ng`. Autopilot sends
from members' relay addresses on the main domain, e.g. `ada.k3x9p2@remotehustle.name.ng`, and employers'
replies come back to them. The relay is on the main domain because Cloudflare's catch-all routing rule only
works there, not on subdomains.

1. **SES** (region Europe (Ireland)): create a domain identity for each of `mail.i-jobs.remotehustle.name.ng`
   and `remotehustle.name.ng` with Easy DKIM and a custom MAIL FROM (`bounce.`), and add the records it lists
   in Cloudflare, all DNS only. Add one DMARC record on the main domain (it covers subdomains):
   `_dmarc` TXT `v=DMARC1; p=quarantine; rua=mailto:dmarc@remotehustle.name.ng`. Create the configuration set
   `ijobs-relay` with an event destination for Bounce and Complaint to an SNS topic, and subscribe
   `https://ijobs-api.remotehustle.name.ng/v1/hooks/ses` (HTTPS) to it. The engine confirms the subscription itself.
   Put the topic ARN in `SES_SNS_TOPIC_ARNS`. Do the same for the account configuration set.
2. **Receiving:** turn on Cloudflare Email Routing for `remotehustle.name.ng`. Add a custom address
   `dmarc@remotehustle.name.ng` that forwards to your own inbox, then deploy the worker:

```bash
cd infra/email-worker && npm install
npx wrangler deploy
npx wrangler secret put INBOUND_EMAIL_SECRET    # the same value as the engine's
```

   In Email Routing → Routing rules, set the catch-all to "Send to a Worker" → `ijobs-email-worker`.
   Specific addresses (like `dmarc@`) still win over the catch-all.
3. **Warm-up:** `sending_domains.daily_limit` starts at 50. Raise it slowly (for example 50 → 100
   → 200 a week) while bounces stay under 2% and complaints under 0.1%.

## 8. Backups (Cloudflare R2)

1. In Cloudflare, create an R2 bucket `ijobs-backups` and an API token with read/write to it only.
2. `rclone config`:
   - remote `r2`: type `s3`, provider `Cloudflare`, the token's key and secret,
     endpoint `https://<account-id>.r2.cloudflarestorage.com`.
   - remote `r2-crypt`: type `crypt`, remote `r2:ijobs-backups`, generate a strong password.
     **Keep the crypt passwords in a password manager.** Without them the backups cannot be read.
3. Try it: `/opt/ijobs/infra/scripts/backup.sh`
4. Schedule it: `crontab -e` → `17 2 * * * /opt/ijobs/infra/scripts/backup.sh >> /var/log/ijobs-backup.log 2>&1`

Keeps 14 days of nightly backups, plus the first of each month for a year. The R2 free tier (10 GB)
holds this comfortably for the beta.

### Restoring

```bash
scripts/restore.sh                                    # list backups
scripts/restore.sh daily/ijobs-2026-11-19T0217Z.dump  # restores into a new database, ijobs_restore
```

It never touches the live database. To switch over after checking the restored copy:

```bash
docker compose stop api worker
docker compose exec postgres psql -U postgres -c "ALTER DATABASE ijobs RENAME TO ijobs_old" \
  -c "ALTER DATABASE ijobs_restore RENAME TO ijobs"
docker compose start api worker
```

**Test a restore once a month.** A backup nobody has restored is a guess.

## Limits to watch on this server

- **Memory.** `docker stats`. If Postgres and the worker together pass ~9 GB, lower `shared_buffers`
  or move the worker to a second free server.
- **Disk.** The free boot volume is up to 200 GB total across instances; job descriptions and vectors
  grow fastest. The `jobs_max_60_days` rule and the expiry job keep this in check.
- **Oracle reclaims idle free servers** (very low CPU for 7 days). A live engine is never idle, but don't
  leave a test server sitting empty.
