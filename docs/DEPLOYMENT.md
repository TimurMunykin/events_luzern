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
REQUEST_NOTIFY_TO=natalijakljap@gmail.com
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
