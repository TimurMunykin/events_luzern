# Events.Luzern staging

Full application from the same repository: landing, `/login`, `/admin/`,
`/prototypes/`, PocketBase and its migrations. `staging/compose.yml` overrides
only environment settings on top of `docker-compose.yml`. The guest register is
`/admin/#/guests`, inside the existing admin, with the same login.

## Environments

- Shared VPS: `88.99.85.240`.
- Production checkout: `/opt/events_luzern`, branch `main`.
- Staging checkout: `/opt/events_luzern_staging/repo`, branch `codex/stripe-staging`.
- Staging configuration: `/opt/events_luzern_staging/staging/.env` (mode 600).
- Staging data: `/opt/events_luzern_staging/staging/data`.
- Compose project/network: `events-luzern-staging` / `events-luzern-staging_default`.
- URL: <https://staging.events-luzern.ch/>.
- DNS: wildcard CNAME `*` → `events-luzern.ch`; named records keep priority.
  Caddy routes each configured hostname to its application and obtains HTTPS.
- The former sslip.io URL redirects to this address. Set `STAGING_LEGACY_ORIGIN`
  to that old origin so previously downloaded test-ticket QR codes still scan.

The three staging containers have a combined 768 MiB memory ceiling. They mount
no production data, credentials or application directory. PocketBase and SMTP
have no published ports. The staging HTTP port binds only to the production
proxy's Docker bridge address (`172.18.0.1:8088`), not the public interface.

## Deploy

Push an approved change to `codex/stripe-staging`. `Deploy staging` checks the
configuration and JavaScript, checks out that exact commit in the staging repo,
and rebuilds the staging Compose project. It never runs the production workflow.
The repository secret `DEPLOY_SSH_KEY` supplies the existing server SSH access;
`STAGING_KNOWN_HOSTS` pins the server's verified SSH host key.

The shared HTTPS proxy has a host-level `docker-compose.override.yml`, installed
from `edge.compose.yml`, and `/opt/events_luzern_staging/edge.Caddyfile`. This
wrapper imports production's own Caddyfile and adds only the staging hostname.
It survives production Git updates; it does not freeze production's routes.
Do not replace production application files or select a public version to deploy staging.

The root page uses the normal PocketBase renderer with `APP_ENV=staging` and
`STAGING_SITE_VERSION=aurora-v22e.html`. No `site_config.current_version` is changed.
The gallery and its existing controls remain available to Natali.

## Local run

Copy `.env.example` to `.env`, fill in the Stripe Sandbox secrets and a separate
admin password.
Use `CHECKOUT_ORIGIN=http://localhost:8088` locally.

```sh
docker compose --env-file staging/.env -f docker-compose.yml -f staging/compose.yml up -d --build
```

- The public site opens without a password or browser authentication dialog.
- Existing admin login: `STAGING_ADMIN_EMAIL` (default `natali@events-luzern.test`),
  password `TICKET_STAFF_PASSWORD`. The staging-only bootstrap creates this local
  account once; it does not change production accounts or rotate passwords.
  Admin, gallery and test inbox use this same login page and session.
- Every outgoing email, including the existing request forms, goes to Mailpit at
  `/mail/`. No messages leave through a real SMTP server. Mailpit retains its inbox
  across container updates, capped at 500 messages.
- Stripe uses Sandbox `Events Luzern staging` (`acct_1UXPqFDMEhMEEqtc`). Live keys
  are rejected. The webhook is `/api/events/stripe-webhook`; checkout sessions are
  verified server-side before named tickets are issued. The API keeps its normal
  PocketBase access rules; private pages require the existing admin session.
- Public tickets have an opaque link, QR and calendar file. The guest register
  supports search, manual/QR check-in and detection of already-used tickets.
- An accidental arrival can be undone from the guest row or immediately after a
  scan. This clears only attendance; the paid ticket remains valid for another
  scan. An old screen cannot undo an arrival that was recorded again later.
- Branded tickets and email support RU/DE/EN, stable event-level ticket numbers,
  map/calendar links and a downloadable PDF. Apple Wallet requires a separate
  Apple pass certificate and is not enabled.
- The payment result displays every full ticket. The page, confirmation email
  and reminder share the ticket template; PDF uses the same layout and colours.
  Buyer emails use singular/plural wording by ticket count, and a guest's
  individual email always describes one ticket.
- Keep Sandbox orders, tickets and numbering in this database. Never copy them
  into production. A new real event starts numbering at 001; any previously
  paid guests must be imported separately from Natali's confirmed list before
  real sales open. Do not reset numbers once real tickets have been issued.
- Capacity is the total allocation for online sales, including online purchases
  already paid. Checkout reserves places for at most one hour. Use «Вернуть оплату»
  beside a guest to refund that ticket's full price and cancel only her ticket.
  A confirmed refund releases one place and disables that ticket's QR, calendar
  and reminders. Other tickets in the order remain valid. Full refunds cancel all
  tickets. CSV includes each ticket's validity and both ticket/order refund amounts.
- Refund requests are private, durable records with a stable Stripe idempotency
  key. Pending refunds keep admission valid; a later bank failure restores it.
  Webhooks and a reconciliation job fetch current provider state. An unresolved
  request older than 23 hours requires reconciliation, never a blind new refund.
- If money was refunded directly in Stripe, open «Вернуть оплату» for the relevant
  guest and choose «Отменить этот билет». This assigns the existing refund without
  sending money again. Until assigned, a partial external refund does not identify
  a guest and therefore leaves tickets valid. An external refund smaller than one
  ticket's price requires manual review in Stripe; it cannot cancel a whole ticket.
- Sandbox webhook subscriptions must include checkout.session.completed,
  checkout.session.async_payment_succeeded, checkout.session.expired,
  charge.refunded, refund.created, refund.updated, refund.failed and
  charge.refund.updated. The handler fetches current Stripe state to handle replays.
- Entrance/what-to-bring text and reminders are edited in the guest register.
  Reminders run once in the 24 hours before an event. Unknown entrance details
  and event end times stay blank. SMTP retries can duplicate mail if the process
  dies between SMTP acceptance and saving the delivery flag.

## Verification

`tests/test_staging.py` covers the full site, existing login/admin/gallery,
private guest records, isolated SMTP and the four existing request forms.
`tests/test_checkout.py` covers server prices, retry safety and webhook validation.
`tests/test_tickets.py` covers QR/calendar, concurrent check-in, pagination,
separate guest mail, reminders and duplicate suppression.
`tests/test_refunds.py` uses real Stripe Sandbox payment intents/refunds to cover
per-ticket cancellation, concurrent retries, external refund assignment, missed
responses, stale webhooks, capacity, CSV and reminders. It also waits for Stripe's
pending-refund and bank-failure test methods to settle (several minutes).

Set `STAGING_ORIGIN`, `TICKET_STAFF_PASSWORD`, and
`STRIPE_WEBHOOK_SECRET`; run `python3 -m unittest discover -s tests -v`.
Refund tests also require `STRIPE_SECRET_KEY`, restricted to `sk_test_` keys.
For local-only ticket fixtures also set `STAGING_DB_PATH` to the staging SQLite
file and give the process write access. QR/calendar checks need `zxing-cpp`,
`Pillow`, `icalendar`. Fixtures use only their own labelled records and cannot run
against a remote database. Complete a real Stripe Sandbox checkout in the browser
separately; fixture tests do not prove payment. All contact details must be fictional.
