# Portside Pottery — Plan 4: Migration & Production Deploy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the app to a VPS you control — media in S3-compatible storage, schema managed by migrations, existing Square members imported, nightly backups, HTTPS via Caddy — and cut `portsidepottery.com` over from GoDaddy safely.

**Architecture:** A Dockerized Next.js (standalone) container behind Caddy (auto-HTTPS), with PostgreSQL in a sibling container and uploaded media offloaded to an S3-compatible bucket. Schema changes go through Payload migrations rather than dev "push". A one-time import backfills `Members` from existing Square customers/subscriptions. Backups run nightly via cron.

**Tech Stack:** Docker + Docker Compose, Caddy, PostgreSQL 16, `@payloadcms/storage-s3`, Square Node SDK, `pg_dump`.

**Depends on:** Plans 1–3 complete and green.

**Commit identity:** repo-local `briswells <briswells@gmail.com>`. **No AI attribution in commit messages.**

**Operational note:** this plan changes production-affecting config. Do the staging deploy (Task 7) before any DNS change (Task 8). Keep GoDaddy live until the staging smoke passes.

---

## File Structure (added by this plan)

```
.
├── Dockerfile
├── docker-compose.prod.yml
├── Caddyfile
├── .dockerignore
├── .env.production.example       # documents prod env (committed; real values NOT committed)
├── scripts/
│   ├── backup.sh                 # pg_dump to offsite
│   └── import-square-members.ts  # one-time backfill
├── next.config.mjs               # MODIFY: output: 'standalone'
└── src/payload.config.ts         # MODIFY: s3Storage plugin + migration mode
```

---

## Task 1: S3-compatible media storage

**Files:**
- Modify: `src/payload.config.ts`
- Modify: `.env.example`, `.env`

- [ ] **Step 1: Install the storage plugin**

Run:
```bash
pnpm add @payloadcms/storage-s3
```

- [ ] **Step 2: Add S3 env vars**

Append to `.env.example` (set real values in `.env` for testing; in prod they come from the prod env file):
```bash
S3_BUCKET=portside-media
S3_REGION=auto
S3_ENDPOINT=https://<account>.r2.cloudflarestorage.com
S3_ACCESS_KEY_ID=replace
S3_SECRET_ACCESS_KEY=replace
```
(Any S3-compatible provider works — Cloudflare R2, Backblaze B2, AWS S3. R2 shown.)

- [ ] **Step 3: Add the plugin to `src/payload.config.ts`**

```ts
import { s3Storage } from '@payloadcms/storage-s3'

// inside buildConfig:
plugins: [
  s3Storage({
    collections: { media: true },
    bucket: process.env.S3_BUCKET!,
    config: {
      region: process.env.S3_REGION,
      endpoint: process.env.S3_ENDPOINT,
      forcePathStyle: true,
      credentials: {
        accessKeyId: process.env.S3_ACCESS_KEY_ID!,
        secretAccessKey: process.env.S3_SECRET_ACCESS_KEY!,
      },
    },
  }),
],
```

- [ ] **Step 4: Verify uploads land in the bucket**

Run `pnpm dev`, upload an image in `/admin` → Media.
Expected: the object appears in the S3 bucket; the admin preview loads from it. Stop the server.

- [ ] **Step 5: Commit**

```bash
git add src/payload.config.ts .env.example package.json pnpm-lock.yaml
git commit -m "Store uploaded media in S3-compatible storage"
```

---

## Task 2: Switch schema to migrations

**Files:**
- Modify: `src/payload.config.ts`
- Create: `src/migrations/` (generated)
- Modify: `package.json`

- [ ] **Step 1: Disable dev push in production**

In `src/payload.config.ts`, set the Postgres adapter to push only outside production:

```ts
db: postgresAdapter({
  pool: { connectionString: process.env.DATABASE_URL },
  push: process.env.NODE_ENV !== 'production',
}),
```

- [ ] **Step 2: Add migration scripts to `package.json`**

```json
"migrate:create": "payload migrate:create",
"migrate": "payload migrate"
```

- [ ] **Step 3: Generate the initial migration**

Run:
```bash
pnpm migrate:create initial
```
Expected: a timestamped file under `src/migrations/` capturing the current schema.

- [ ] **Step 4: Verify the migration applies to a fresh database**

Run:
```bash
docker compose -f docker-compose.dev.yml exec -T db psql -U portside -d portside -c "CREATE DATABASE portside_migrate_check;" || true
DATABASE_URL=postgres://portside:portside@localhost:5432/portside_migrate_check NODE_ENV=production pnpm migrate
```
Expected: migration runs cleanly with no errors.

- [ ] **Step 5: Commit**

```bash
git add src/payload.config.ts src/migrations package.json
git commit -m "Manage schema via Payload migrations in production"
```

---

## Task 3: Existing-member import script

**Files:**
- Create: `scripts/import-square-members.ts`
- Modify: `package.json`

Backfill `Members` from existing Square customers that have a subscription, so current members aren't re-enrolled.

- [ ] **Step 1: Implement the idempotent import**

Create `scripts/import-square-members.ts`:

```ts
import { getPayload } from 'payload'
import config from '@payload-config'
import { getSquareClient, SQUARE_LOCATION_ID } from '../src/lib/square'

const PLAN_VARIATION_ID = process.env.SQUARE_MEMBERSHIP_PLAN_VARIATION_ID

async function run() {
  const payload = await getPayload({ config })
  const client = getSquareClient()

  // 1. Find subscriptions at our location (optionally filtered to our plan).
  const search = await client.subscriptions.search({
    query: { filter: { locationIds: [SQUARE_LOCATION_ID()] } },
  })
  const subscriptions = search.subscriptions ?? []
  let created = 0, skipped = 0

  for (const sub of subscriptions) {
    if (PLAN_VARIATION_ID && sub.planVariationId !== PLAN_VARIATION_ID) { skipped++; continue }
    if (!sub.customerId || !sub.id) { skipped++; continue }

    // Already imported?
    const existing = await payload.find({ collection: 'members', where: { squareSubscriptionId: { equals: sub.id } }, limit: 1 })
    if (existing.totalDocs > 0) { skipped++; continue }

    const customerRes = await client.customers.get({ customerId: sub.customerId })
    const c = customerRes.customer
    const email = c?.emailAddress ?? `${sub.customerId}@imported.portsidepottery.com`
    const name = [c?.givenName, c?.familyName].filter(Boolean).join(' ') || 'Imported Member'

    const statusMap: Record<string, string> = { ACTIVE: 'active', PAUSED: 'paused', CANCELED: 'cancelled', DEACTIVATED: 'cancelled' }
    await payload.create({
      collection: 'members', overrideAccess: true,
      data: {
        name, email, password: require('crypto').randomBytes(24).toString('hex'),
        phone: c?.phoneNumber, status: statusMap[sub.status ?? 'ACTIVE'] ?? 'active',
        joinedDate: sub.startDate, squareCustomerId: sub.customerId, squareSubscriptionId: sub.id,
        subscriptionStatus: sub.status,
      },
    })
    created++
  }

  console.log(`Import complete. Created ${created}, skipped ${skipped}.`)
  process.exit(0)
}

run().catch((e) => { console.error(e); process.exit(1) })
```
Note: confirm `subscriptions.search` / `customers.get` shapes against the installed SDK version; adjust pagination (`cursor`) if you have more than one page of subscriptions.

- [ ] **Step 2: Add the script**

Add to `package.json` `"scripts"`: `"import:members": "tsx scripts/import-square-members.ts"`.

- [ ] **Step 3: Dry-run against sandbox**

With at least one sandbox subscription present, run:
```bash
pnpm import:members
```
Expected: prints created/skipped counts; re-running creates 0 (idempotent); imported members appear in `/admin`.

- [ ] **Step 4: Commit**

```bash
git add scripts/import-square-members.ts package.json
git commit -m "Add one-time Square members import script"
```

---

## Task 4: Production container

**Files:**
- Create: `Dockerfile`
- Create: `.dockerignore`
- Modify: `next.config.mjs`

- [ ] **Step 1: Enable standalone output**

In `next.config.mjs`, ensure the config includes:
```js
const nextConfig = {
  output: 'standalone',
  // ...keep the existing withPayload wrapper and any other settings
}
```
(Keep the existing `withPayload(nextConfig)` export from the scaffold.)

- [ ] **Step 2: Create `.dockerignore`**

```
node_modules
.next
.git
media
.env
.env.*
.superpowers
docs
tests
```

- [ ] **Step 3: Create the Dockerfile**

```dockerfile
# ---- deps ----
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# ---- build ----
FROM node:20-alpine AS build
WORKDIR /app
RUN corepack enable
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

# ---- run ----
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
RUN corepack enable
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/package.json ./package.json
# tsx + source needed for migrate/seed/import scripts at runtime
COPY --from=build /app/src ./src
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3000
CMD ["node", "server.js"]
```

- [ ] **Step 4: Build the image locally to verify**

Run:
```bash
docker build -t portside-app .
```
Expected: image builds with no errors.

- [ ] **Step 5: Commit**

```bash
git add Dockerfile .dockerignore next.config.mjs
git commit -m "Add production Dockerfile with Next standalone output"
```

---

## Task 5: Production compose + Caddy

**Files:**
- Create: `docker-compose.prod.yml`
- Create: `Caddyfile`
- Create: `.env.production.example`

- [ ] **Step 1: Create `.env.production.example`**

```bash
NODE_ENV=production
DATABASE_URL=postgres://portside:CHANGE_ME@db:5432/portside
PAYLOAD_SECRET=CHANGE_ME_LONG_RANDOM
PUBLIC_BASE_URL=https://portsidepottery.com
# Square (PRODUCTION credentials)
SQUARE_ENVIRONMENT=production
SQUARE_ACCESS_TOKEN=CHANGE_ME
SQUARE_LOCATION_ID=CHANGE_ME
SQUARE_WEBHOOK_SIGNATURE_KEY=CHANGE_ME
SQUARE_MEMBERSHIP_PLAN_VARIATION_ID=CHANGE_ME
NEXT_PUBLIC_SQUARE_APP_ID=CHANGE_ME
NEXT_PUBLIC_SQUARE_LOCATION_ID=CHANGE_ME
NEXT_PUBLIC_SQUARE_ENVIRONMENT=production
# Email
RESEND_API_KEY=CHANGE_ME
EMAIL_FROM="Portside Pottery <no-reply@portsidepottery.com>"
STAFF_NOTIFY_EMAIL=getcreative@portsidepottery.com
# S3 media
S3_BUCKET=portside-media
S3_REGION=auto
S3_ENDPOINT=CHANGE_ME
S3_ACCESS_KEY_ID=CHANGE_ME
S3_SECRET_ACCESS_KEY=CHANGE_ME
# Postgres container
POSTGRES_PASSWORD=CHANGE_ME
```

- [ ] **Step 2: Create `docker-compose.prod.yml`**

```yaml
services:
  app:
    build: .
    restart: unless-stopped
    env_file: .env.production
    depends_on: [db]
    expose: ["3000"]

  db:
    image: postgres:16-alpine
    restart: unless-stopped
    environment:
      POSTGRES_USER: portside
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: portside
    volumes:
      - pgdata:/var/lib/postgresql/data

  caddy:
    image: caddy:2-alpine
    restart: unless-stopped
    ports: ["80:80", "443:443"]
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - caddy_data:/data
      - caddy_config:/config
    depends_on: [app]

volumes:
  pgdata:
  caddy_data:
  caddy_config:
```

- [ ] **Step 3: Create the `Caddyfile`**

```
portsidepottery.com, www.portsidepottery.com {
    encode gzip
    reverse_proxy app:3000
}
```

- [ ] **Step 4: Commit**

```bash
git add docker-compose.prod.yml Caddyfile .env.production.example
git commit -m "Add production compose stack with Caddy and Postgres"
```

---

## Task 6: Nightly backups

**Files:**
- Create: `scripts/backup.sh`

- [ ] **Step 1: Create the backup script**

Create `scripts/backup.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail
# Run on the VPS host. Dumps the Postgres container DB and uploads offsite.
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="/tmp/portside-${STAMP}.sql.gz"
docker compose -f docker-compose.prod.yml exec -T db pg_dump -U portside portside | gzip > "${OUT}"
# Upload to S3-compatible storage (requires awscli configured with the bucket creds):
aws --endpoint-url "${S3_ENDPOINT}" s3 cp "${OUT}" "s3://${S3_BACKUP_BUCKET}/db/portside-${STAMP}.sql.gz"
rm -f "${OUT}"
echo "Backup uploaded: portside-${STAMP}.sql.gz"
```

- [ ] **Step 2: Make it executable and document the cron + restore**

Run:
```bash
chmod +x scripts/backup.sh
```
Add to the repo README or an ops note (and to the VPS crontab) — nightly at 02:30:
```
30 2 * * * cd /opt/portside && S3_ENDPOINT=... S3_BACKUP_BUCKET=portside-backups ./scripts/backup.sh >> /var/log/portside-backup.log 2>&1
```
Restore procedure (document it):
```bash
gunzip -c portside-YYYYMMDD-HHMMSS.sql.gz | docker compose -f docker-compose.prod.yml exec -T db psql -U portside -d portside
```

- [ ] **Step 3: Verify the dump locally against the dev DB**

Run:
```bash
docker compose -f docker-compose.dev.yml exec -T db pg_dump -U portside portside | gzip > /tmp/test-dump.sql.gz && ls -la /tmp/test-dump.sql.gz
```
Expected: a non-empty gzipped dump file.

- [ ] **Step 4: Commit**

```bash
git add scripts/backup.sh
git commit -m "Add nightly Postgres backup script"
```

---

## Task 7: Staging deploy & smoke

**Files:** none (operational)

- [ ] **Step 1: Provision the VPS**

Create the VPS, install Docker + Docker Compose, clone the repo to `/opt/portside`, and copy a real `.env.production` (from `.env.production.example`) with **production Square keys** and a strong `PAYLOAD_SECRET` + `POSTGRES_PASSWORD`.

- [ ] **Step 2: Point a staging hostname at the VPS**

Temporarily set `staging.portsidepottery.com` in the `Caddyfile` and DNS, so you can test with HTTPS without touching the live apex domain.

- [ ] **Step 3: Bring up the stack and run migrations + import**

Run on the VPS:
```bash
docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml exec app pnpm migrate
docker compose -f docker-compose.prod.yml exec app pnpm import:members
```
Expected: app healthy; schema migrated; existing members imported.

- [ ] **Step 4: Configure the production Square webhook**

In the Square Dashboard (production), add a webhook subscription to `https://staging.portsidepottery.com/api/webhooks/square` for `payment.updated`, `invoice.payment_made`, `invoice.updated`, `subscription.updated`; set the matching `SQUARE_WEBHOOK_SIGNATURE_KEY`.

- [ ] **Step 5: Smoke test on staging**

Verify: all four public pages render; `/admin` login works; a real (small) class booking charges and emails; a membership signup creates a subscription; a webhook event updates a member. Use a real card cautiously or Square's production test affordances, and refund test charges.

- [ ] **Step 6: Commit any fixes found during smoke**

```bash
git add -A
git commit -m "Fixes from staging smoke test"
```

---

## Task 8: Production cutover

**Files:** none (operational)

- [ ] **Step 1: Pre-cutover checklist**
  - Staging smoke green (Task 7).
  - Backups confirmed running and a test restore succeeded.
  - Seed default staff passwords rotated; the seeded `changeme-*` accounts have real strong passwords or are removed. Confirm at least one real admin user exists.
  - `.env.production` has production (not sandbox) Square keys and `NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`.

- [ ] **Step 2: Lower DNS TTL ahead of time**

At GoDaddy DNS, lower the TTL on the apex/`www` records to 300s a day before cutover for a fast rollback.

- [ ] **Step 3: Switch the Caddyfile + DNS to the live domain**

Update `Caddyfile` to `portsidepottery.com, www.portsidepottery.com`, redeploy, then point GoDaddy DNS A/AAAA (and `www` CNAME) at the VPS IP.
Expected: Caddy obtains a Let's Encrypt cert; the live domain serves the new site over HTTPS.

- [ ] **Step 4: Repoint the production webhook to the live URL**

Update the Square production webhook subscription to `https://portsidepottery.com/api/webhooks/square`.

- [ ] **Step 5: Post-cutover verification**

Verify live: pages render; admin login; one real booking + refund; webhook delivery succeeds (check Square's delivery log). Monitor email deliverability (SPF/DKIM for the sending domain).

- [ ] **Step 6: Decommission**

After 1–2 weeks stable, cancel the GoDaddy Website Builder/Appointments subscription. Keep the domain registration wherever you prefer.

- [ ] **Step 7: Commit final config**

```bash
git add Caddyfile
git commit -m "Cut production domain over to the new stack"
```

---

## Self-Review

**Spec coverage (Plan 4 scope):**
- Docker Compose on a VPS (app + Postgres + Caddy auto-HTTPS) — Tasks 4–5. ✓
- Media in S3-compatible storage — Task 1. ✓
- Nightly Postgres backups offsite + documented restore — Task 6. ✓
- Existing-member import from Square — Task 3. ✓
- Staging-first, keep GoDaddy until verified, then DNS cutover — Tasks 7–8. ✓
- Secrets in env, never in repo — `.env.production.example` is committed; real `.env.production` is gitignored (`.env.*`). ✓
- Production hardening (rotate seed passwords) — Task 8 Step 1. ✓
- Migrations instead of dev push in prod — Task 2. ✓

**Placeholder scan:** `CHANGE_ME` values appear only in `.env.production.example`, which is intentionally a template of secrets to fill on the VPS — not code placeholders. The two "confirm SDK shape" notes (Task 3) are genuine version-dependent checks, flagged not hidden. ✓

**Type consistency:** the import script reuses `getSquareClient`/`SQUARE_LOCATION_ID` (Plan 2) and the `Members` field names + status map from Plan 3 (`active|paused|cancelled`, `squareCustomerId`, `squareSubscriptionId`, `subscriptionStatus`, `joinedDate`). Webhook event list in Task 7 Step 4 matches the events handled in Plan 2/3. ✓

**Cross-plan dependency check:** Plan 4 assumes `output: 'standalone'` is compatible with the scaffold's `withPayload` wrapper — verified by the local `docker build` in Task 4 Step 4 before any deploy. ✓
