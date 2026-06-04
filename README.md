# Portside Pottery

Website for Portside Pottery: a Next.js 16 frontend with Payload CMS 3 (headless) backed by Postgres.

## Stack

- **Next.js 16** (App Router)
- **Payload CMS 3.85** (collections: Users, Classes; globals: SiteSettings, HomePage, MembershipPage)
- **PostgreSQL** (via `@payloadcms/db-postgres`)
- **pnpm 11** / Node 24

## Local setup

### 1. Start Postgres

```bash
docker compose -f docker-compose.dev.yml up -d
```

Create the test database once (for integration tests):

```bash
psql -U postgres -c "CREATE DATABASE portside_test;"
```

### 2. Environment

```bash
cp .env.example .env
# Edit .env — set DATABASE_URI, PAYLOAD_SECRET, etc.
```

### 3. Install & run

```bash
pnpm install
pnpm dev          # Next.js dev server at http://localhost:3000
                  # Payload admin at http://localhost:3000/admin
```

### 4. Seed sample data

```bash
pnpm seed
```

## Testing

```bash
pnpm test:int     # Vitest integration tests (uses portside_test DB)
pnpm test:e2e     # Playwright end-to-end tests (Playwright launches its own dev server)
```

## Build

```bash
pnpm build
pnpm start
```

## Roadmap

Booking/payments (Plan 2), membership portal (Plan 3), and gift-card/loyalty features (Plan 4) are future phases. Design decisions and implementation plans are under `docs/superpowers/`.
