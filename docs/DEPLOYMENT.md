# Deployment

The production shape is intentionally small:

- Caddy serves the static site and terminates HTTPS.
- PocketBase stores form requests in SQLite and provides the admin UI.
- Docker Compose runs the stack locally and on the VPS.

## Local

```bash
cp .env.example .env
docker compose up --build
```

Open:

- Site: <http://localhost:8080/>
- PocketBase admin: <http://localhost:8080/_/>

On first run, create the PocketBase superuser in the admin UI. The `requests` collection is created by migration.

## Site structure: live version + gated gallery

- `/` serves the **current live version** of the site. PocketBase resolves it from the `site_config.current_version` record (seeded to `aurora-v16a.html`) and returns that prototype's HTML.
- `/assets/*` is the public shared media for the live page (maps to `prototypes/assets/*`).
- `/prototypes/` is the **internal gallery, behind login**. Caddy gates it via `forward_auth` to the PocketBase `/pb-gate` endpoint.
- `/login` is the public login page. It authenticates against the **PocketBase superuser** (the same account used for `/_/`) and stores the token in the `pb_auth` cookie.

### Switching the live version

Natali may select the public version herself or explicitly authorise an agent to
activate the version she has chosen.

1. Open `/login` and sign in with the PocketBase superuser.
2. You are sent to `/prototypes/`. The card currently on the site shows a **★ LIVE** badge.
3. Click **«Сделать текущей»** on any version — `/` switches to it immediately (no redeploy).

The superuser doubles as the gallery login. To create or reset it:

```bash
docker compose exec pocketbase /pb/pocketbase superuser upsert <email> <password>
```

## Production VPS

1. Point the domain A/AAAA record to the VPS.
2. Install Docker and Docker Compose.
3. Clone the repository on the server.
4. Create `.env` from `.env.example`.
5. Use production ports and the real domain:

```env
SITE_DOMAIN=events-luzern.ch
HTTP_PORT=80
HTTPS_PORT=443
PB_VERSION=0.35.0
REQUEST_NOTIFY_TO=info@events-luzern.ch
```

6. Start the stack:

```bash
docker compose up -d --build
```

Caddy will request and renew HTTPS certificates automatically for `SITE_DOMAIN`.

## Email Notifications

PocketBase stores requests even without email configured. To send notifications:

1. Open `/_/` as the PocketBase superuser.
2. Configure SMTP and sender settings in PocketBase.
3. Set `REQUEST_NOTIFY_TO` in `.env`.
4. Restart:

```bash
docker compose up -d
```

## Live ticket sales

Production uses its existing database, SMTP settings and administrator accounts.
Never copy the staging database, Sandbox purchases or test logins into production.
The same code supports both modes; `staging/compose.yml` explicitly selects test
mode and rejects live keys. Production requires all of the following:

```env
APP_ENV=production
CHECKOUT_ENABLED=true
CHECKOUT_ORIGIN=https://events-luzern.ch
CHECKOUT_NOTIFY_TO=info@events-luzern.ch
STRIPE_MODE=live
STRIPE_SECRET_KEY=rk_live_replace_me
STRIPE_WEBHOOK_SECRET=whsec_replace_me
TICKET_PAGE_FILE=ticket-v22h.html
```

Keep secrets only in the server's mode-600 `.env`. The restricted Stripe key needs
write access to Checkout Sessions, Payment Intents, and Charges and Refunds.
Webhook Endpoints write access is needed when configuring the endpoint. Use the
live Events.Luzern account; verify card and TWINT availability there separately.

Register `https://events-luzern.ch/api/events/stripe-webhook` in that account with
API version `2025-02-24.acacia` and these events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.expired`,
`charge.refunded`, `refund.created`, `refund.updated`, `refund.failed`,
`charge.refund.updated`. Its signing secret is separate from the Sandbox secret.

Release sequence:

1. Take a consistent SQLite backup with SQLite's backup API, plus the existing
   `.env`, before deploying. Preserve the server's shared-proxy Compose override.
2. Deploy the reviewed code. The initial production event is disabled, and no
   test staff account is created. Existing forms and the selected page remain.
3. Import only Natali's confirmed guest list through the authenticated
   `/api/events/staff/import-guests` endpoint described in `staging/README.md`.
   Preserve existing ticket numbers, amounts received and unpaid reservations.
   Check the import summary and next ticket number before opening sales. Import
   does not resend old confirmation emails.
4. Check the webhook signature/mode validation and existing SMTP delivery.
   Coordinate the page switch with opening sales so visitors can pay as soon as
   the purchase button appears. When Natali authorises an agent to launch her
   chosen page, update `site_config.current_version` and the event's `enabled`
   flag in one transaction. Verify `/` serves that page and seats are available.
5. Natali completes a real card/TWINT purchase. Verify payment, email, PDF/QR,
   guest registration and the purchase notification before declaring completion.

`CHECKOUT_ENABLED=false` disables all ticket routes and delivery jobs; use it for
initial setup only. To stop new sales while preserving paid guests' tickets,
disable the event (`checkout_events.enabled=false`) instead. Never roll back to
a database snapshot after real purchases without reconciling those purchases.

## CI/CD

The GitHub Actions workflow always runs checks on `main`.

Deploy is disabled until the repository variable is set:

```text
DEPLOY_ENABLED=true
```

Required GitHub secrets:

```text
DEPLOY_HOST
DEPLOY_USER
DEPLOY_PATH
DEPLOY_SSH_KEY
```

The deploy job connects over SSH, resets the server checkout to `origin/main`, and runs:

```bash
docker compose up -d --build --remove-orphans
```

## Backups

PocketBase persistent data lives in:

```text
data/pocketbase
```

Back this directory up regularly. A minimal VPS cron can archive it:

```bash
cd /path/to/events_luzern
mkdir -p backups
tar -czf "backups/pocketbase-$(date +%F-%H%M).tgz" data/pocketbase
```
