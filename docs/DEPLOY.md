# Portside Pottery — Production Deploy Runbook

This is the operator runbook for **Plan 4 Tasks 7–8** (staging deploy + production
cutover). Everything in the repo (Tasks 1–6) is done: S3-capable media, migrations,
the production `Dockerfile`/`docker-compose.prod.yml`/`Caddyfile`, the member-import
script, and nightly backups. These steps require a VPS, **production** Square
credentials, and DNS access — they are not automated.

> **Golden rule:** do the full staging deploy and smoke test (Stage A) **before** any
> DNS change (Stage B). Keep the GoDaddy site live until staging passes.

---

## Prerequisites

- A VPS (2 vCPU / 2–4 GB RAM is plenty) with Docker + Docker Compose installed.
- DNS control for `portsidepottery.com` (currently GoDaddy).
- A **production** Square account: access token, location id, application id, a
  **subscription plan + $200/mo plan variation**, and a webhook signing key.
- A Resend account with a **verified sending domain** for `EMAIL_FROM`.
- An S3-compatible bucket for media (Cloudflare R2 / Backblaze B2 / AWS S3) and a
  second bucket for DB backups, plus `awscli` configured on the host.

---

## The production env file (`.env.production`)

Copy the template and fill in every value. This file is **gitignored** — never commit it.

```bash
cp .env.production.example .env.production
# then edit .env.production
```

Notes that will bite you if skipped:

- **`POSTGRES_PASSWORD` must match the password embedded in `DATABASE_URL`.** Both the
  `app` and `db` services read this same file; the db initializes its superuser
  password from `POSTGRES_PASSWORD`, and the app connects with the password inside
  `DATABASE_URL=postgres://portside:<PASSWORD>@db:5432/portside`. Keep them identical.
- **`PAYLOAD_SECRET`** must be a long random string (e.g. `openssl rand -hex 32`).
- **`SQUARE_ENVIRONMENT=production`** and **`NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`**
  (the browser SDK URL switches on the `NEXT_PUBLIC_` one).
- **`PUBLIC_BASE_URL`** must exactly match the URL registered for the Square webhook
  (scheme + host, no trailing slash) — signature verification fails otherwise.
- **`S3_BACKUP_BUCKET`** is consumed by `scripts/backup.sh` (separate from the media
  bucket). `awscli` on the host must be configured with credentials for it.

---

## Stage A — Staging deploy & smoke (Plan 4 Task 7)

1. **Provision & clone.** On the VPS: install Docker, `git clone` to `/opt/portside`,
   and create `/opt/portside/.env.production` as above (with **production** Square keys).

2. **Point a staging hostname at the VPS.** Temporarily set the `Caddyfile` to
   `staging.portsidepottery.com` and add that DNS A/AAAA record → VPS IP. This lets you
   test over HTTPS without touching the live apex domain.

3. **Bring up the stack, migrate, import.**
   ```bash
   cd /opt/portside
   docker compose -f docker-compose.prod.yml up -d --build
   # Schema: production has dev-push DISABLED, so apply the migration explicitly:
   docker compose -f docker-compose.prod.yml exec app pnpm migrate
   # One-time backfill of existing Square members:
   docker compose -f docker-compose.prod.yml exec app pnpm import:members
   ```
   - The image **builds without a database** (the CMS pages render per-request), so a
     cold `--build` is fine.
   - `import:members` prints `Created/skipped/failed`. **If it logs a pagination
     WARNING**, the Square account has more than one page of subscriptions and the
     script only imported the first page — import the rest manually or extend the
     script's cursor handling before relying on it.
   - Create at least one **real admin user** (and rotate/remove the seeded
     `changeme-*` accounts — see Stage B checklist).

4. **Register the production Square webhook.** Point it at
   `https://staging.portsidepottery.com/api/webhooks/square` and subscribe to:
   `payment.updated`, `refund.updated`, `invoice.payment_made`, `invoice.updated`,
   `subscription.updated`. Set the matching `SQUARE_WEBHOOK_SIGNATURE_KEY` in
   `.env.production` and restart the `app` service.

5. **Smoke test on staging:**
   - All public pages render (`/`, `/classes`, `/classes/<slug>`, `/membership`,
     `/visit`, `/gallery`, `/staff`); `/admin` login works.
   - A real (small) class booking charges, shows "Booked!", and emails a confirmation;
     a paid `Bookings` row + a `Payments` row appear in `/admin`.
   - A membership signup creates a Square subscription and an active `Members` row.
   - Trigger/observe a webhook (e.g. the booking payment) and confirm Square's delivery
     log shows `200` and the record reconciles.
   - **Refund** the test charges afterward.

6. **Verify a backup round-trip** before trusting it:
   ```bash
   S3_ENDPOINT=... S3_BACKUP_BUCKET=portside-backups ./scripts/backup.sh
   # then test a restore into a scratch DB:
   gunzip -c portside-YYYYMMDD-HHMMSS.sql.gz | \
     docker compose -f docker-compose.prod.yml exec -T db psql -U portside -d portside
   ```

---

## Stage B — Production cutover (Plan 4 Task 8)

**Pre-cutover checklist (all must be true):**
- [ ] Stage A smoke is green.
- [ ] A backup ran **and a test restore succeeded**.
- [ ] Seeded `changeme-*` staff passwords rotated or removed; at least one real admin exists.
- [ ] `.env.production` has **production** Square keys and `NEXT_PUBLIC_SQUARE_ENVIRONMENT=production`.

1. **Lower DNS TTL** on the apex + `www` records to 300s at GoDaddy a day ahead, for a fast rollback.

2. **Switch Caddy + DNS to the live domain.** Set the `Caddyfile` back to
   `portsidepottery.com, www.portsidepottery.com`, redeploy
   (`docker compose -f docker-compose.prod.yml up -d`), then point GoDaddy DNS
   A/AAAA (apex) and the `www` record at the VPS IP. Caddy will obtain a Let's Encrypt
   cert automatically.

3. **Repoint the Square webhook** to `https://portsidepottery.com/api/webhooks/square`
   and update `PUBLIC_BASE_URL` accordingly (restart `app`).

4. **Post-cutover verification (live):** pages render over HTTPS; admin login; one real
   booking + refund; Square webhook delivery shows `200`; confirm email deliverability
   (SPF/DKIM for the sending domain).

5. **Schedule nightly backups** (host crontab, 02:30):
   ```
   30 2 * * * cd /opt/portside && S3_ENDPOINT=... S3_BACKUP_BUCKET=portside-backups ./scripts/backup.sh >> /var/log/portside-backup.log 2>&1
   ```

6. **Decommission GoDaddy** after 1–2 weeks stable: cancel the GoDaddy Website
   Builder/Appointments subscription. Keep the domain registration wherever you prefer.

---

## Operational notes & known limitations (from review)

- **Production uses migrations, not dev-push.** Any future schema change needs
  `pnpm migrate:create <name>` committed and `pnpm migrate` run on deploy. (Dev/test
  still auto-push, so local work is unchanged.)
- **Member import** only guards against duplicate *subscriptions*; a re-run after the
  site is live will skip-and-log members whose email already exists (it won't abort).
  It imports only the first page of Square subscriptions (warns if more exist).
- **`Payments` rows are an append-only ledger** — the webhook updates `Bookings`/`Members`
  status but does not rewrite historical `Payments` rows.
- **Hardcoded $200/`20000`** appears in the welcome email, the membership payment row,
  and the membership page label. If the plan price changes, update those (search `20000`).
- **The webhook membership branches and the cancel/pause hook have no automated tests** —
  exercise them deliberately during the Stage A smoke (esp. a `subscription.updated`
  cancel from Square, to confirm the member flips to cancelled without an echo loop).
- **Image size (~1.6 GB):** the runner keeps full `node_modules` + `src` so `pnpm migrate`
  / `import:members` can run inside the container. Fine for a single-VPS deploy.

---

## Apple Pay on the class booking form (production)

Apple Pay only appears on HTTPS + Safari/Apple devices; Google Pay and Cash App Pay need
no extra setup. To enable Apple Pay:

1. In the **Square Dashboard → Apple Pay**, register your production domain (the exact
   public hostname customers use — e.g. the Cloudflare-tunnel domain).
2. Square provides a **domain-association file**. Put its contents in the
   `APPLE_PAY_DOMAIN_ASSOCIATION` env var (in `.env.production`). The app serves it at
   `https://<domain>/.well-known/apple-developer-merchantid-domain-association`.
3. Confirm `https://<domain>/.well-known/apple-developer-merchantid-domain-association`
   returns the file over HTTPS, then complete verification in the Square dashboard.

**Cloudflare tunnel:** serving the app over HTTP behind a Cloudflare tunnel that
terminates TLS is fine — Apple only sees the public `https://<domain>`. BUT the storefront
and especially the `/.well-known/...` path must be **publicly reachable, NOT behind a
Cloudflare Access (Zero-Trust login) policy**, or Apple/Square's verification fetch hits
the login page and fails (and customers couldn't shop). The tunnel for connectivity is
fine; an Access auth gate on public routes is not. The Apple-Pay-registered domain,
`PUBLIC_BASE_URL`, and the Square webhook URL should all be that same public hostname.
