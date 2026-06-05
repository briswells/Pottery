# Deploying Portside Pottery on Unraid

This stands the app up on Unraid as a single container that **reuses your existing
Postgres container** and your **existing Cloudflare tunnel** for HTTPS. The image is
built by GitHub Actions and pulled from GHCR; uploaded media lives on a persistent
Unraid share.

**Method:** GitHub Actions → GHCR image → Unraid **Docker Compose Manager** plugin →
behind your Cloudflare tunnel. Postgres is reached over a shared Docker network.

---

## 0. One-time: get the image building (GHCR)

`.github/workflows/docker-publish.yml` builds and pushes `ghcr.io/briswells/pottery:latest`
on every push to `main`.

1. **Set the public Square build values as repo Variables** (github.com → repo →
   Settings → **Secrets and variables → Actions → Variables** tab). These get baked into
   the browser bundle at build time — without them the booking/wallet form won't load in
   production (the rest of the site still works). They are **public** client identifiers,
   not secrets, so Variables (not Secrets) is correct:
   - `NEXT_PUBLIC_SQUARE_APP_ID` — e.g. `sandbox-sq0idb-…`
   - `NEXT_PUBLIC_SQUARE_LOCATION_ID` — e.g. `LMDEFJRFBWN3E`
   - `NEXT_PUBLIC_SQUARE_ENVIRONMENT` — `sandbox` (or `production` later)

   > Server-side Square values (`SQUARE_ACCESS_TOKEN`, etc.) are read at **runtime** from
   > `.env.production`, so those are NOT build args and stay out of the image.

2. Push to `main` (or run the workflow manually from the repo's **Actions** tab).
3. When it finishes, the package appears at **github.com/briswells?tab=packages**. It's
   **private** by default.
4. Create a **Personal Access Token (classic)** with the **`read:packages`** scope
   (github.com → Settings → Developer settings → PATs → Tokens (classic)). You'll use it
   to let Unraid pull the private image.

> The build needs no database — the app's CMS pages render per-request (`force-dynamic`),
> so CI builds the image cleanly. When you switch Square from sandbox to production, update
> the three repo Variables above and re-run the workflow so the new values are baked in.

---

## 1. Postgres: create the database

On your existing Postgres container, create a database + user for the app:
```sql
CREATE DATABASE portside;
CREATE USER portside WITH PASSWORD 'a-strong-password';
GRANT ALL PRIVILEGES ON DATABASE portside TO portside;
```
(If your Postgres is Postgres 15+, also: connect to `portside` and
`GRANT ALL ON SCHEMA public TO portside;`)

**Find the network** your Postgres container is on (Unraid → Docker → the container's
network, or `docker inspect <pg-container> --format '{{json .NetworkSettings.Networks}}'`).
You'll put the app on the same **user-defined** network so it can reach Postgres by
container name. (If Postgres is only on the default `bridge`, you'll instead use the
Unraid host IP and the published Postgres port in `DATABASE_URL`.)

---

## 2. Let Unraid pull the private image

On the Unraid box (terminal):
```bash
echo "<YOUR_READ_PACKAGES_PAT>" | docker login ghcr.io -u briswells --password-stdin
```
(Or make the GHCR package **public** in its package settings and skip this — but private +
login is recommended.)

---

## 3. Create the stack

Install the **Docker Compose Manager** plugin (Community Applications) if you haven't.

1. Add a new stack (e.g. `pottery`). Paste the contents of `docker-compose.unraid.yml`
   from this repo.
2. **Edit the network name**: set `networks.postgres.name` to the user-defined network
   from step 1. (If Postgres is on the default bridge only, delete both `networks:`
   blocks from the compose and use the host IP in `DATABASE_URL` instead.)
3. Create the media share directory: `/mnt/user/appdata/pottery/media`.
4. Create `.env.production` in the stack folder (next to the compose). Copy
   `.env.production.example` from the repo and fill it in:
   ```bash
   NODE_ENV=production
   # host = your Postgres CONTAINER NAME (shared network) or <unraid-ip> (bridge)
   DATABASE_URL=postgres://portside:a-strong-password@<postgres-container-name>:5432/portside
   PAYLOAD_SECRET=<openssl rand -hex 32>
   PUBLIC_BASE_URL=https://<your-tunnel-domain>
   # Square (sandbox now; production values when you go live)
   SQUARE_ENVIRONMENT=sandbox
   SQUARE_ACCESS_TOKEN=<...>
   SQUARE_LOCATION_ID=<...>
   SQUARE_WEBHOOK_SIGNATURE_KEY=<...>
   SQUARE_MEMBERSHIP_PLAN_VARIATION_ID=<...>
   NEXT_PUBLIC_SQUARE_APP_ID=<...>
   NEXT_PUBLIC_SQUARE_LOCATION_ID=<...>
   NEXT_PUBLIC_SQUARE_ENVIRONMENT=sandbox
   RESEND_API_KEY=<...>
   EMAIL_FROM="Portside Pottery <no-reply@portsidepottery.com>"
   STAFF_NOTIFY_EMAIL=getcreative@portsidepottery.com
   # leave S3 blank — media uses the mounted /app/media volume
   S3_BUCKET=
   APPLE_PAY_DOMAIN_ASSOCIATION=
   ```
   > The `NEXT_PUBLIC_SQUARE_*` lines in `.env.production` are **ignored at runtime** —
   > those three are baked into the image at build time from the repo **Variables** you
   > set in step 0. Setting them here too is harmless for clarity, but the build-time
   > Variables are what actually take effect. Everything else here is read at runtime.

5. **Compose up** the stack.

---

## 4. First run: migrate the schema

Production has dev schema-push disabled, so create the tables once:
```bash
docker exec portside-pottery pnpm migrate
```
Expected: it applies `…_initial` and `…_firings`. (Re-running is safe — already-applied
migrations are skipped.)

Create your first admin user at `https://<your-tunnel-domain>/admin` (the very first
account the panel lets you create), then add real content. Don't run `pnpm seed` in
production — that's demo data.

---

## 5. Cloudflare tunnel route

Point a public hostname at the app:
- Tunnel → Public Hostname → your domain → service `http://<unraid-ip>:3000`
  (or `http://portside-pottery:3000` if your `cloudflared` container is on the same
  Docker network as the app).

**Important (Zero Trust):** do **not** put a Cloudflare **Access** (login) policy in front
of the public site or the `/.well-known/...` path — it must be publicly reachable, or
Apple Pay verification and customers' access break (see `docs/DEPLOY.md`). You can keep
`/admin` behind Access if you want staff-only gating.

Make sure `PUBLIC_BASE_URL` matches this hostname exactly (it's used for Square webhook
signature verification).

---

## 6. Updating later

1. Push to `main` → the workflow rebuilds `:latest`.
2. On Unraid: pull + recreate the stack (Compose Manager "Update"/"Compose up", or
   `docker compose -f docker-compose.unraid.yml pull && ... up -d`).
3. If the update includes new migrations, run `docker exec portside-pottery pnpm migrate`
   again.

For rollback, pin a specific image tag (the workflow also tags each build `sha-<short>`)
instead of `latest`.

---

## Checklist before real payments / go-live

Everything in `docs/DEPLOY.md` still applies — notably: real **production** Square keys
(set `*_ENVIRONMENT=production`), register the Square webhook at
`https://<domain>/api/webhooks/square` for `payment.updated`, `refund.updated`,
`invoice.payment_made`, `invoice.updated`, `subscription.updated`; verify the Resend
sending domain; and (optional) Apple Pay domain registration via
`APPLE_PAY_DOMAIN_ASSOCIATION`. Back up Postgres on a schedule (`scripts/backup.sh` or
your Unraid backup workflow).
