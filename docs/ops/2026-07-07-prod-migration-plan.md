# Production Migration Plan — portsidepottery.com

**Date:** 2026-07-07
**Status:** Approved plan, pending execution

## Overview

Stand up the production stack on a new droplet under all-new accounts, verify it
end-to-end at `dev.portsidepottery.com`, connect production Square, then leave
GoDaddy entirely (registrar → Cloudflare, mailbox → Purelymail) and cut the real
domain over. GoDaddy remains registrar through Phases 1–2; Cloudflare serves DNS
from Phase 1 on.

| | Current (dev) | Target (prod) |
|---|---|---|
| Droplet | 206.189.255.28 (`~/.ssh/id_ed25519`) | **138.197.232.44** (`~/.ssh/id_ed25519_portside`) |
| Domain | brianwells.org | dev.portsidepottery.com → portsidepottery.com (Phase 3) |
| Registrar | — | GoDaddy → Cloudflare Registrar (Phase 3) |
| DNS/CDN/Tunnel | Cloudflare (personal acct) | **New** Cloudflare account (from Phase 1) |
| Email sending | Resend (zerakan.com domain) | **New** Resend account, `email.portsidepottery.com` |
| Mailbox (inbound) | — | getcreative@portsidepottery.com: GoDaddy → **Purelymail** (Phase 3) |
| Media | Droplet-local Docker volume | **Cloudflare R2** from day one |
| Square | Sandbox | Sandbox (Phase 1) → **Production** (Phase 2) |
| Secrets | Dev values | All new (PAYLOAD_SECRET, DB password, API keys) |

**Hard constraints learned on dev (do not relearn):**
- `NEXT_PUBLIC_SQUARE_*` are **build-time** args — all three must be passed to
  `docker build`; omitting APP_ID silently ships a dead payment form.
- Square webhook signature verification binds to the **exact** `PUBLIC_BASE_URL`
  + `/api/webhooks/square` string — webhook URL and `PUBLIC_BASE_URL` must always
  change together.
- Production runs with `push` off — schema arrives via `pnpm payload migrate` only.
- The 1GB droplet can't build; build `linux/amd64` locally → `docker save | ssh docker load`.

---

## Phase 1 — Everything live at dev.portsidepottery.com (Square stays sandbox)

### 1.0 Access check
- `ssh -i ~/.ssh/id_ed25519_portside root@138.197.232.44 'uname -a'`
- Add an SSH alias to `~/.ssh/config` so tooling stays simple:
  ```
  Host portside-prod
    HostName 138.197.232.44
    User root
    IdentityFile ~/.ssh/id_ed25519_portside
    IdentitiesOnly yes
  ```

### 1.1 DNS foundation — move DNS to Cloudflare WITHOUT breaking the live site/email
1. **Export a full DNS record list from GoDaddy first** (screenshot + zone export).
   The records that must survive: the current website's A/CNAME records, **MX**,
   and every TXT (SPF, DKIM, domain verifications).
2. New Cloudflare account → Add site `portsidepottery.com` (Free plan) →
   Cloudflare scans and imports records. **Diff the imported zone against the
   GoDaddy export line by line**; add anything missed (MX and TXT are the usual
   casualties).
3. Set the imported website records to **DNS-only (grey cloud)** initially — the
   GoDaddy-hosted site must behave byte-identically after the switch. (Proxying
   the old site is a later optimization, not part of this migration.)
4. At GoDaddy: replace the nameservers with the two Cloudflare-assigned ones.
5. **Verify before proceeding** (allow up to 24h, usually minutes):
   - `dig NS portsidepottery.com +short` → Cloudflare pair
   - `dig MX portsidepottery.com +short` → unchanged values
   - Old website loads; a test email to getcreative@portsidepottery.com arrives.

GoDaddy is now registrar-only. Everything else in this plan happens in Cloudflare.

### 1.2 Provision the prod droplet (mirror the dev runbook)
On `portside-prod`:
- 2GB swap (`fallocate`/`mkswap`/`swapon` + fstab + `vm.swappiness=10`).
- Docker via `get.docker.com`; cloudflared via Cloudflare's apt repo.
- `/opt/portside/` with the app+db `docker-compose.yml` (same shape as dev: app
  on `127.0.0.1:3000`, `postgres:16-alpine`, `pgdata` + `media` volumes — media
  volume kept as a fallback even though R2 is primary).
- **All-new secrets**: generate `PAYLOAD_SECRET` (`openssl rand -hex 32`) and the
  Postgres password (`openssl rand -hex 16`). Never reuse dev values.

### 1.3 New service accounts
1. **Resend (new account):** add domain `email.portsidepottery.com` → put its
   DKIM/SPF records into the Cloudflare zone → verify → create API key.
   `EMAIL_FROM=Portside Pottery <portside@email.portsidepottery.com>`.
   (Subdomain sending cannot conflict with the root domain's mailbox SPF.)
2. **Cloudflare R2:** create bucket `portside-media` (+ `portside-backups`) →
   R2 API token (Object Read & Write) → note the S3 endpoint
   `https://<account_id>.r2.cloudflarestorage.com`. The app's S3 plugin activates
   automatically when the `S3_*` vars are set (`forcePathStyle` already true).
3. **Cloudflare Tunnel:** Zero Trust → Tunnels → create `portside-prod` →
   `cloudflared service install <token>` on the droplet → **Published
   application route**: `dev.portsidepottery.com` → `HTTP://localhost:3000`.

### 1.4 `.env.production` template (prod droplet, chmod 600)
```
NODE_ENV=production
DATABASE_URL=postgres://portside:<NEW_PG_PASSWORD>@db:5432/portside
POSTGRES_PASSWORD=<NEW_PG_PASSWORD>
PAYLOAD_SECRET=<NEW_64_HEX>
PUBLIC_BASE_URL=https://dev.portsidepottery.com
# Square — SANDBOX in Phase 1 (booking/coupon flows stay testable)
SQUARE_ENVIRONMENT=sandbox
SQUARE_ACCESS_TOKEN=<sandbox token>
SQUARE_LOCATION_ID=<sandbox location>
SQUARE_WEBHOOK_SIGNATURE_KEY=<sandbox webhook key for the NEW url>
# Email
RESEND_API_KEY=<new resend key>
EMAIL_FROM=Portside Pottery <portside@email.portsidepottery.com>
STAFF_NOTIFY_EMAIL=getcreative@portsidepottery.com   # fallback only; Site Settings email wins
# Media on R2
S3_BUCKET=portside-media
S3_REGION=auto
S3_ENDPOINT=https://<account_id>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=<r2 key>
S3_SECRET_ACCESS_KEY=<r2 secret>
S3_BACKUP_BUCKET=portside-backups
```

### 1.5 Deploy
Local build (sandbox client ids in Phase 1):
```
docker build --platform linux/amd64 \
  --build-arg NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox \
  --build-arg NEXT_PUBLIC_SQUARE_APP_ID=<sandbox app id> \
  --build-arg NEXT_PUBLIC_SQUARE_LOCATION_ID=<sandbox location> \
  -t portside:prod .
docker save portside:prod | gzip -1 | ssh portside-prod 'gunzip | docker load'
ssh portside-prod 'cd /opt/portside && docker compose up -d db && docker compose run --rm app pnpm payload migrate && docker compose up -d app'
```
No demo seed on prod. First admin via `/admin` create-first-user; then enter Site
Settings (studio name, phone, hours, **email = getcreative@portsidepottery.com**,
logo upload → verifies R2 in passing).

### 1.6 Cloudflare parity + backups
- Cache Rule: path contains `/api/media/file/` → eligible, Edge TTL 1 month.
- Smart Tiered Caching on. Email obfuscation is on by default (fine).
- Nightly DB backup: cron `pg_dump` → `portside-backups` R2 bucket via the
  repo's `scripts/backup.sh` (awscli configured with the R2 endpoint). Verify a
  restore once before Phase 2 puts real data in.

### Phase 1 exit checklist
- [ ] Old GoDaddy site + mailbox unaffected (spot-check after 24h)
- [ ] `https://dev.portsidepottery.com` home/admin 200 through the tunnel
- [ ] Contact form → email arrives (Reply-To = visitor); honeypot post sends nothing
- [ ] Media upload lands in R2 and serves; gallery checkbox flow works
- [ ] Sandbox booking: card (normal ZIP), declined card (ZIP 99999 → friendly
      message), coupon discount, 100%-coupon free booking
- [ ] Sandbox webhook (new subscription → `https://dev.portsidepottery.com/api/webhooks/square`) delivers 200
- [ ] Shelves/members/classes admin flows; backup cron produced a restorable dump

---

## Phase 2 — Square production

1. Square Developer Dashboard → the **production** application: production
   `APP_ID`, `LOCATION_ID`, `ACCESS_TOKEN`.
2. **Rebuild** the image with production client args (build-time!):
   `NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`, production APP_ID + LOCATION_ID
   → ship → update server env (`SQUARE_ENVIRONMENT=production`, token, location)
   → recreate app.
3. **Production webhook** subscription → `https://dev.portsidepottery.com/api/webhooks/square`
   (events: subscription.created/updated, invoice.updated, invoice.payment_made,
   payment.updated, catalog.version.updated) → put its signature key in env →
   recreate → send `refund.updated` test event → expect 200.
4. First production boot auto-runs: plan sync (real membership plans appear) and
   **member reconcile — all real Square members import automatically**. Verify
   People list matches reality; investigate any "skipped" log lines.
5. Apple Pay: register `dev.portsidepottery.com` in Square, set
   `APPLE_PAY_DOMAIN_ASSOCIATION` env. (Repeat for the apex in Phase 3.)
6. **Live-fire test (real money):** create a hidden $1 test class, book it with a
   real card, confirm the payment in the Square production dashboard, refund it,
   verify the refund webhook flips the booking to `refunded`. Delete the test class.

### Phase 2 exit checklist
- [ ] Real plans + members visible in admin; counts sane
- [ ] $1 live charge succeeded and refunded; booking reflects both
- [ ] Production webhook shows 200s in Square's delivery log
- [ ] Coupons apply against real prices (sandbox codes recreated in prod admin)

---

## Phase 3 — Leave GoDaddy entirely

Order matters: **mailbox first**, then registrar, then apex cutover, then teardown.

### 3.1 Mailbox migration → Purelymail (with full backup/restore)
1. Identify what GoDaddy sold: legacy **Workspace Email** (IMAP:
   `imap.secureserver.net:993`) or resold **Microsoft 365** (IMAP:
   `outlook.office365.com:993`). This only changes the source host below.
2. Purelymail account → add domain `portsidepottery.com` → create user
   `getcreative` → add Purelymail's MX/SPF/DKIM records (values from their setup
   page) to the Cloudflare zone **but hold the MX flip** until after the first sync.
   (Purelymail's root-domain SPF coexists fine with Resend's, which lives on the
   `email.` subdomain.)
3. **Full backup + first restore** with imapsync (also archive locally):
   ```
   imapsync --host1 <godaddy imap> --user1 getcreative@portsidepottery.com --password1 '<pw>' \
            --host2 imap.purelymail.com --user2 getcreative@portsidepottery.com --password2 '<pw>' \
            --automap
   ```
   Plus a local archive (Thunderbird account → export, or `imapsync --justfolders`
   + a `mbsync`/`offlineimap` dump) stored somewhere durable — the backup must
   exist independent of both providers.
4. **MX flip** in Cloudflare (GoDaddy MX out, Purelymail MX in). Send/receive
   test both directions. Old mail keeps flowing to GoDaddy for stragglers during
   propagation.
5. After 48h: **final delta imapsync** (same command; it's idempotent), then the
   GoDaddy mailbox is disposable.

### 3.2 Registrar transfer → Cloudflare
- Preconditions: domain unlocked at GoDaddy, privacy off, **EPP/auth code**
  obtained, registrant email accessible, and not within 60 days of registration
  /prior transfer/registrant-contact change (ICANN lock).
- Cloudflare dashboard → Domain Registration → Transfer (zone already active
  here, so the transfer is **zero-downtime** — DNS never moves).
- Approve fast via GoDaddy's pending-transfer screen instead of waiting 5 days.

### 3.3 Apex cutover — one coordinated change-set
1. Tunnel: add published routes `portsidepottery.com` and `www.portsidepottery.com`
   → `HTTP://localhost:3000` (delete/replace the old site's A/CNAME records —
   Cloudflare will prompt on conflict).
2. Droplet env: `PUBLIC_BASE_URL=https://portsidepottery.com` → recreate app.
3. **Same change-set:** Square production webhook URL →
   `https://portsidepottery.com/api/webhooks/square` (signature binds to the URL);
   send a test event → 200.
4. Apple Pay: register the apex domain in Square.
5. Cloudflare redirect rule: `www.portsidepottery.com/*` → `https://portsidepottery.com/$1` (301).
6. Keep `dev.portsidepottery.com` as a staging alias or delete its route.
7. **Rollback:** restore the old A/CNAME records and revert `PUBLIC_BASE_URL` +
   webhook URL — the old GoDaddy site is untouched until teardown.

### 3.4 GoDaddy teardown (after a 2-week stability window)
- [ ] New site stable at apex; email flowing via Purelymail; no webhook failures
- [ ] Cancel GoDaddy hosting/site product, email plan, and any auto-renewals
- [ ] Final check: nothing else references GoDaddy (dig NS/MX/TXT audit)

---

## Decision log
- Mailbox destination: **Purelymail** (user choice; IMAP-standard, imapsync-friendly).
- Media: **R2 from day one**; local `media` volume retained as fallback.
- Resend sends from `email.portsidepottery.com` (subdomain isolation).
- The existing GoDaddy site + mailbox must not break during Phases 1–2.
- Old dev instance (brianwells.org / 206.189.255.28) stays as dev/staging.
