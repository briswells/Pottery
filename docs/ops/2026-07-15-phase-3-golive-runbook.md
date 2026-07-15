# Phase 3 Go-Live Runbook — portsidepottery.com off GoDaddy

Prepared 2026-07-15 from live recon. Companion to
`2026-07-07-prod-migration-plan.md` (Phase 3); this is the executable version
with current facts, owners, and rollback per step.

## Current state (verified 2026-07-15)

| Thing | Value |
|---|---|
| Nameservers | GoDaddy (`ns71/ns72.domaincontrol.com`) |
| Apex / www | AWS Global Accelerator IPs `13.248.243.5`, `76.223.105.230` (GoDaddy Website Builder); `www` CNAME → apex |
| dev | A → `138.197.232.44` (prod droplet, Caddy direct TLS) |
| MX | Proofpoint Essentials (`mx1/2/3-usg1.ppe-hosted.com`) in front of **Microsoft 365** (GoDaddy-resold: `MS=ms51766296`, autodiscover → outlook.com) |
| SPF (apex) | `v=spf1 include:spf.em.secureserver.net include:_spf-usg1.ppe-hosted.com include:secureserver.net ~all` |
| DMARC | `p=none`, rua → onsecureserver.net |
| Resend (keep!) | `send.email` TXT SPF + MX (amazonses), `resend._domainkey.email` TXT (DKIM) |
| Misc records seen | apex TXT `MS=ms51766296`, `email` CNAME → email.secureserver.net (GoDaddy webmail default), `lyncdiscover` → lync.com |
| Domain | Registered 2025-02-19 (60-day rule ✓), expires 2027-02-19, GoDaddy transfer-locked (normal). Transfer adds +1yr for ~$10.44 |
| Droplet | cloudflared installed but no tunnel configured; app serves on localhost:3000 behind Caddy |
| Square | Production creds live; webhook + Apple Pay bound to `dev.portsidepottery.com` — both must move at apex cutover |

**Key risk found:** the mailbox is GoDaddy-resold **Microsoft 365 behind
Proofpoint**. M365 usually has IMAP basic-auth disabled and GoDaddy restricts
tenant admin, so `imapsync` may not work directly. The mailbox dry-run below
happens BEFORE picking a cutover date; fallback is an Outlook/Thunderbird full
export (PST/local folders) → IMAP copy into Purelymail.

## Pre-flight — do ahead of go-live day

### Brian (accounts & credentials — can't be delegated)
- [ ] **GoDaddy DNS export**: DNS zone screenshot + export (Domain → DNS → Export). Send to Claude for the line-by-line diff.
- [ ] **Purelymail**: create account (~$10/yr), add domain `portsidepottery.com`, create user `getcreative`, note the MX/SPF/DKIM values from their setup page + the new mailbox password.
- [ ] **Mailbox access for backup**: confirm you can sign in to the getcreative@ mailbox (webmail/Outlook). For the dry run: try enabling IMAP or plan on the Outlook-export fallback.
- [ ] **Cloudflare**: the existing account (R2) is ready; adding the site is a guided click-through — Claude preps, you click "Add site" and later paste the two Cloudflare nameservers into GoDaddy.
- [ ] **GoDaddy transfer prep** (can wait until 3.2): unlock domain, turn off privacy, request the EPP/auth code, keep access to the registrant email. Payment method on Cloudflare for the ~$10.44 transfer (extends registration +1yr).
- [ ] **Square dashboard** (day-of, ~5 min): change the production webhook URL and add the apex Apple Pay domain when Claude says go.
- [ ] Pick a **cutover window** (a weekday morning is ideal — Purelymail + Square steps take under an hour combined, and you're around for the smoke test).

### Claude (prep with no user action needed)
- [ ] Build the DNS record inventory to import into Cloudflare (recon above + your zone export diff).
- [ ] `brew install imapsync` locally; dry-run the M365 → Purelymail sync (or validate the export fallback) once Purelymail creds exist.
- [ ] Configure the Cloudflare Tunnel on the droplet (`cloudflared` already installed) with routes for apex + www, ready but unused until 3.3.
- [ ] Prep the droplet env change (`PUBLIC_BASE_URL=https://portsidepottery.com`) and the deploy — applied only at 3.3.
- [ ] Draft the DMARC/SPF records for the post-GoDaddy world (drop secureserver/ppe includes; Purelymail SPF at apex; keep Resend's subdomain records untouched).

## Go-live sequence (order matters)

### 3.0 DNS → Cloudflare (zero behavior change)
1. Claude: add site in Cloudflare (with Brian at the dashboard), import zone, diff against the GoDaddy export, add anything missed (MX + TXT are the usual casualties), set all site records **DNS-only (grey cloud)**.
2. Brian: replace nameservers at GoDaddy with the Cloudflare pair.
3. Claude verifies: `dig NS/MX/TXT` values unchanged, old site loads, dev site loads, test email to getcreative@ arrives, a firing/class confirmation email sends (Resend).
   **Rollback:** switch nameservers back at GoDaddy (records there are untouched).

### 3.1 Mailbox → Purelymail
1. Claude: add Purelymail MX/SPF/DKIM records to the Cloudflare zone, **MX flip held**.
2. Claude: full backup + first sync (imapsync from `outlook.office365.com:993`, or the export fallback from the dry run) + a local archive stored off both providers.
3. MX flip in Cloudflare (Proofpoint out, Purelymail in). Both-direction send/receive test with Brian.
4. After 48h: final delta sync; GoDaddy mailbox is then disposable.
   **Rollback:** restore the Proofpoint MX records (kept in the zone file, disabled).

### 3.2 Registrar → Cloudflare (zero downtime, any time after 3.0)
- Brian: unlock + EPP code at GoDaddy, start transfer in Cloudflare, approve from GoDaddy's pending-transfer screen (minutes instead of 5 days). DNS never moves — the zone is already on Cloudflare.

### 3.3 Apex cutover — one coordinated change-set (~15 min)
1. Claude: enable the prepared tunnel routes for apex + www (replacing the Website Builder A/CNAME records), set `PUBLIC_BASE_URL=https://portsidepottery.com`, recreate app.
2. Brian (same sitting): Square webhook URL → `https://portsidepottery.com/api/webhooks/square`, send test event; add apex to Apple Pay domains (Claude serves the file automatically) and Verify.
3. Claude: www→apex 301 redirect rule; smoke test — homepage, classes, a $1-style booking flow to the payment form, webhook 200, admin login, media loads.
4. Keep `dev.portsidepottery.com` as staging alias.
   **Rollback:** restore old A/CNAME records, revert `PUBLIC_BASE_URL` + webhook URL. Old GoDaddy site is untouched until teardown.

### 3.4 Teardown (after 2 stable weeks)
- Brian: cancel GoDaddy Website Builder, M365/email plan, auto-renewals.
- Claude: final `dig` audit that nothing references GoDaddy/secureserver; tighten DMARC to `p=quarantine` once only Resend+Purelymail send.

## What can go wrong (and the answer)
- **M365 IMAP blocked** → Outlook/Thunderbird export fallback, validated in the dry run before any date is picked.
- **Zone import misses records** → line-by-line diff against your export before the NS flip; recon inventory above is the cross-check.
- **Mail gap during MX flip** → old MX keeps working through propagation; senders retry for 48h+; final delta sync catches stragglers.
- **Webhook signature breaks at cutover** → URL and PUBLIC_BASE_URL move in the same change-set; test event before walking away; 6-hour reconcile is the safety net for anything missed.
- **Apple Pay stops at apex** → apex domain registered in Square at cutover; dev registration stays valid for staging.
