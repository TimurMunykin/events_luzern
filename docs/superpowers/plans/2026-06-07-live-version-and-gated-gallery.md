# Live home page + gated gallery with version switching — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Serve a chosen "live" prototype at `/` publicly, put the prototype gallery behind a PocketBase login, and let an authenticated admin switch the live version from the gallery with one click (no redeploy).

**Architecture:** Caddy routes `/` and `/assets/*` and `/login` publicly, gates `/prototypes/*` via `forward_auth` to a PocketBase endpoint, and proxies `/api/*` + `/_/` to PocketBase. PocketBase stores the current version in a `site_config` record, resolves `/` to that prototype's HTML from a read-only mount, and validates the gate token. The gallery page becomes a small client that marks the LIVE version and PATCHes `site_config` to switch.

**Tech Stack:** Caddy 2.10, PocketBase 0.35.0 (JSVM hooks + migrations), Docker Compose, vanilla JS (no SDK bundle).

---

## Reference (read before starting)

- Spec: `docs/superpowers/specs/2026-06-07-live-version-and-gated-gallery-design.md`
- Existing hook patterns: `backend/pb_hooks/main.pb.js` (uses `$os.getenv`, `$app`, `onRecordAfterCreateSuccess`, `routerAdd` style globals)
- Existing migration pattern: `backend/pb_migrations/20260530170000_create_requests_collection.js` (`migrate(up, down)`, `new Collection({...})`, `app.save()`)
- Current gallery markup: `prototypes/index.html` — cards are `<a class="card ..." href="aurora-v16a.html">` containing `<div class="preview">…</div>`.
- Current prototype that must stay live initially: `aurora-v16a.html`.

## Local test environment (used by every task's verification)

All verification runs against a local Docker Compose stack on `http://localhost:8080`.

- [ ] **Prep A: create local `.env`** (only if missing)

```bash
cd <repo root>
[ -f .env ] || cp .env.example .env
cat .env   # expect SITE_DOMAIN=:80, HTTP_PORT=8080, HTTPS_PORT=8443, PB_VERSION=0.35.0
```

- [ ] **Prep B: start the stack**

```bash
docker compose up -d --build
docker compose ps   # expect caddy + pocketbase "Up"
```

- [ ] **Prep C: create a local test superuser** (for auth tests)

```bash
docker compose exec pocketbase /pb/pocketbase superuser upsert admin@test.local Test12345!
```
Expected: `Successfully saved superuser "admin@test.local"!`

> Note on Secure cookies: the login page sets a `Secure` cookie, so a real browser won't send it over plain `http://localhost`. All gate checks below use `curl` with an explicit `Cookie:` header, which is unaffected. Browser end-to-end is validated in production over HTTPS.

---

## Task 1: `site_config` collection + seed record (migration)

**Files:**
- Create: `backend/pb_migrations/20260607120000_create_site_config.js`

- [ ] **Step 1: Write the migration**

```javascript
migrate(function (app) {
  var collection = new Collection({
    type: "base",
    name: "site_config",
    listRule: null,
    viewRule: null,
    createRule: null,
    updateRule: null,
    deleteRule: null,
    fields: [
      { name: "current_version", type: "text", required: true, max: 120 }
    ]
  });

  app.save(collection);

  var record = new Record(collection);
  record.set("current_version", "aurora-v16a.html");
  app.save(record);
}, function (app) {
  var collection = app.findCollectionByNameOrId("site_config");
  app.delete(collection);
});
```

- [ ] **Step 2: Rebuild PocketBase and apply the migration**

```bash
docker compose up -d --build pocketbase
docker compose logs pocketbase --since 60s | grep -i "site_config\|migrat" | tail
```
Expected: no migration errors.

- [ ] **Step 3: Verify the seeded record exists (as superuser)**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s http://localhost:8080/api/collections/site_config/records -H "Authorization: $TOKEN"
```
Expected: JSON with one item whose `current_version` is `"aurora-v16a.html"`.

- [ ] **Step 4: Verify it is NOT publicly readable (no token)**

```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/api/collections/site_config/records
```
Expected: `400` or `403` (admin-only rules) — not `200`.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_migrations/20260607120000_create_site_config.js
git commit -m "feat(pb): add site_config collection with current_version seed"
```

---

## Task 2: Mount prototypes into PocketBase; mount login page; drop old root index

**Files:**
- Modify: `docker-compose.yml`
- Delete (later, in Task 8): `index.html`

- [ ] **Step 1: Edit `docker-compose.yml`**

Add the prototypes read-only mount to the `pocketbase` service (so the resolver can read version files), and update the `caddy` volumes: remove the old root `index.html` mount, add `login.html`.

`pocketbase` service — add under `volumes:`:
```yaml
      - ./prototypes:/pb/prototypes:ro
```

`caddy` service `volumes:` — final state:
```yaml
    volumes:
      - ./Caddyfile:/etc/caddy/Caddyfile:ro
      - ./login.html:/srv/site/login.html:ro
      - ./prototypes:/srv/site/prototypes:ro
      - ./data/caddy/data:/data
      - ./data/caddy/config:/config
```
(Removed: `- ./index.html:/srv/site/index.html:ro`.)

- [ ] **Step 2: Create a placeholder `login.html`** so the mount target exists (real content in Task 6)

```bash
printf '<!doctype html><meta charset=utf-8><title>login placeholder</title>' > login.html
```

- [ ] **Step 3: Validate compose config**

```bash
docker compose config >/dev/null && echo OK
```
Expected: `OK`.

- [ ] **Step 4: Recreate containers with new mounts**

```bash
docker compose up -d --build
docker compose exec pocketbase ls /pb/prototypes/aurora-v16a.html
```
Expected: the path prints (file visible inside PB container).

- [ ] **Step 5: Commit**

```bash
git add docker-compose.yml login.html
git commit -m "chore(compose): mount prototypes into pocketbase, add login page mount, drop root index mount"
```

---

## Task 3: PocketBase resolver for `/` (serve current live version)

**Files:**
- Modify: `backend/pb_hooks/main.pb.js` (append at end)

- [ ] **Step 1: Append the resolver code to `backend/pb_hooks/main.pb.js`**

```javascript

// --- Live landing: serve the current version at "/" ---
var PROTOTYPES_DIR = "/pb/prototypes";

function readCurrentVersion(app) {
  try {
    var records = app.findRecordsByFilter("site_config", "id != ''", "", 1, 0);
    if (records && records.length) {
      return String(records[0].get("current_version") || "");
    }
  } catch (err) {
    console.log("[live] cannot read site_config: " + err);
  }
  return "";
}

function isSafeVersionName(name) {
  return typeof name === "string" && /^[a-zA-Z0-9._-]+\.html$/.test(name) && name.indexOf("..") === -1;
}

function fallbackPage() {
  return "<!doctype html><html lang=\"ru\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\">" +
    "<title>Events.Luzern</title></head><body style=\"font-family:sans-serif;background:#0a0a14;color:#e8e8ea;display:flex;min-height:100vh;align-items:center;justify-content:center\">" +
    "<p>Events.Luzern — скоро здесь.</p></body></html>";
}

routerAdd("GET", "/", function (e) {
  var version = readCurrentVersion(e.app);
  if (!isSafeVersionName(version)) {
    return e.html(503, fallbackPage());
  }
  var path = PROTOTYPES_DIR + "/" + version;
  try {
    var html = toString($os.readFile(path));
    return e.html(200, html);
  } catch (err) {
    console.log("[live] cannot read version file " + path + ": " + err);
    return e.html(503, fallbackPage());
  }
});
```

- [ ] **Step 2: Rebuild PocketBase**

```bash
docker compose up -d --build pocketbase
```

- [ ] **Step 3: Verify the resolver returns the current version's HTML**

PocketBase listens on 8090 inside the network; hit it directly via the caddy container to avoid Caddy routing (not wired yet):
```bash
docker compose exec caddy wget -qO- http://pocketbase:8090/ | grep -ci "events" 
```
Expected: a non-zero count (the aurora-v16a HTML contains "Events"/"events"). If it prints `0`, check `docker compose logs pocketbase --since 60s` for `[live]` errors (likely the `$os.readFile` API name — confirm against the installed PocketBase JSVM and adjust the read call until this check passes).

- [ ] **Step 4: Commit**

```bash
git add backend/pb_hooks/main.pb.js
git commit -m "feat(pb): resolve / to the current live prototype version"
```

---

## Task 4: PocketBase auth gate for `forward_auth`

**Files:**
- Modify: `backend/pb_hooks/main.pb.js` (append at end)

- [ ] **Step 1: Append the gate code to `backend/pb_hooks/main.pb.js`**

```javascript

// --- Gate for /prototypes/* (used by Caddy forward_auth) ---
function tokenFromCookie(e) {
  var raw = "";
  try { raw = e.request.header.get("Cookie") || ""; } catch (err) { raw = ""; }
  var parts = raw.split(";");
  for (var i = 0; i < parts.length; i++) {
    var p = parts[i].trim();
    if (p.indexOf("pb_auth=") === 0) {
      return decodeURIComponent(p.substring("pb_auth=".length));
    }
  }
  return "";
}

routerAdd("GET", "/pb-gate", function (e) {
  var token = tokenFromCookie(e);
  if (token) {
    try {
      e.app.findAuthRecordByToken(token, "auth");
      return e.noContent(204);
    } catch (err) {
      // fall through to redirect
    }
  }
  return e.redirect(302, "/login");
});
```

- [ ] **Step 2: Rebuild PocketBase**

```bash
docker compose up -d --build pocketbase
```

- [ ] **Step 3: Verify gate rejects a missing/invalid token**

```bash
docker compose exec caddy wget -S -qO- "http://pocketbase:8090/pb-gate" 2>&1 | grep -i "HTTP/\|Location" | head
```
Expected: a `302` with `Location: /login`.

- [ ] **Step 4: Verify gate accepts a valid token**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
docker compose exec caddy wget -S -qO- --header="Cookie: pb_auth=$TOKEN" "http://pocketbase:8090/pb-gate" 2>&1 | grep -i "HTTP/" | head
```
Expected: `204 No Content` (no redirect). If it redirects, the token type/cookie parsing needs adjustment until this passes.

- [ ] **Step 5: Commit**

```bash
git add backend/pb_hooks/main.pb.js
git commit -m "feat(pb): add /pb-gate auth check for the prototypes gallery"
```

---

## Task 5: Caddy routing

**Files:**
- Modify: `Caddyfile` (full rewrite)

- [ ] **Step 1: Replace `Caddyfile` with:**

```
{$SITE_DOMAIN} {
	encode zstd gzip

	# PocketBase API + admin UI
	handle /api/* {
		reverse_proxy pocketbase:8090
	}
	handle /_ {
		reverse_proxy pocketbase:8090
	}
	handle /_/* {
		reverse_proxy pocketbase:8090
	}

	# Public shared media for the live landing (maps /assets/* -> prototypes/assets/*)
	@assets path /assets/*
	handle @assets {
		root * /srv/site/prototypes
		header Cache-Control "public, max-age=31536000, immutable"
		file_server
	}

	# Public login page
	handle /login {
		rewrite * /login.html
		root * /srv/site
		file_server
	}

	# Gated internal gallery + all prototype files
	handle /prototypes/* {
		forward_auth pocketbase:8090 {
			uri /pb-gate
		}
		root * /srv/site
		file_server
	}

	# Root: current live version, resolved by PocketBase
	handle / {
		reverse_proxy pocketbase:8090
	}

	# Fallback
	handle {
		respond 404
	}
}
```

- [ ] **Step 2: Reload Caddy (Caddyfile is a read-only mount, so restart the container)**

```bash
docker compose restart caddy
docker compose logs caddy --since 30s | grep -i "error\|serving\|adapt" | tail
```
Expected: no config errors.

- [ ] **Step 3: Verify `/` serves the live version through Caddy**

```bash
curl -s http://localhost:8080/ | grep -ci "events"
```
Expected: non-zero.

- [ ] **Step 4: Verify `/assets/*` is public and maps correctly**

```bash
curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:8080/assets/logo.png
```
Expected: `200 image/png`.

- [ ] **Step 5: Verify `/prototypes/` without cookie redirects to /login**

```bash
curl -s -o /dev/null -w "%{http_code} -> %{redirect_url}\n" http://localhost:8080/prototypes/
curl -s -o /dev/null -w "raw file: %{http_code} -> %{redirect_url}\n" http://localhost:8080/prototypes/aurora-v15a.html
```
Expected: both `302 -> http://localhost:8080/login` (raw prototype files are gated too).

- [ ] **Step 6: Verify `/prototypes/` WITH a valid cookie returns 200**

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s -o /dev/null -w "%{http_code}\n" --cookie "pb_auth=$TOKEN" http://localhost:8080/prototypes/
```
Expected: `200`.

- [ ] **Step 7: Commit**

```bash
git add Caddyfile
git commit -m "feat(caddy): public root + assets, gated /prototypes via forward_auth"
```

---

## Task 6: Login page

**Files:**
- Modify: `login.html` (replace placeholder with real page)

- [ ] **Step 1: Replace `login.html` with:**

```html
<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Events.Luzern · Вход</title>
<style>
  *{box-sizing:border-box}
  body{font-family:'Inter',system-ui,sans-serif;background:#0a0a14;color:#e8e8ea;min-height:100vh;display:flex;align-items:center;justify-content:center;margin:0}
  form{background:#1a1a26;border:1px solid rgba(255,255,255,.08);border-radius:10px;padding:36px;width:320px;display:flex;flex-direction:column;gap:14px}
  h1{font-size:20px;margin:0 0 8px}
  input{padding:12px 14px;border-radius:6px;border:1px solid rgba(255,255,255,.12);background:#0f0f18;color:#e8e8ea;font:inherit}
  button{padding:12px 14px;border:none;border-radius:6px;background:#cdb88a;color:#0a0d2e;font-weight:600;cursor:pointer;font:inherit}
  #err{color:#f87171;font-size:13px;min-height:18px;margin:0}
</style>
</head>
<body>
<form id="f">
  <h1>Events.Luzern · вход</h1>
  <input id="email" type="email" placeholder="Email" autocomplete="username" required />
  <input id="password" type="password" placeholder="Пароль" autocomplete="current-password" required />
  <button type="submit">Войти</button>
  <p id="err"></p>
</form>
<script>
document.getElementById('f').addEventListener('submit', async function (ev) {
  ev.preventDefault();
  var err = document.getElementById('err');
  err.textContent = '';
  try {
    var res = await fetch('/api/collections/_superusers/auth-with-password', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        identity: document.getElementById('email').value,
        password: document.getElementById('password').value
      })
    });
    if (!res.ok) throw new Error('Неверный логин или пароль');
    var data = await res.json();
    document.cookie = 'pb_auth=' + encodeURIComponent(data.token) + '; path=/; max-age=1209600; SameSite=Lax; Secure';
    localStorage.setItem('pb_auth', data.token);
    location.href = '/prototypes/';
  } catch (e) {
    err.textContent = e.message || 'Ошибка входа';
  }
});
</script>
</body>
</html>
```

- [ ] **Step 2: Pick up the new file** (login.html is a read-only mount of an existing path; content changes are visible without recreate, but confirm)

```bash
curl -s http://localhost:8080/login | grep -ci "вход"
```
Expected: non-zero (page served at `/login`).

- [ ] **Step 3: Verify login returns a token (the page's API call)**

```bash
curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' -o /dev/null -w "%{http_code}\n"
```
Expected: `200`.

- [ ] **Step 4: Commit**

```bash
git add login.html
git commit -m "feat(web): login page authenticating against PocketBase superuser"
```

---

## Task 7: Gallery — auth guard, LIVE badge, "make current" buttons

**Files:**
- Modify: `prototypes/index.html` (insert script block immediately before `</body>`)

- [ ] **Step 1: Insert this `<script>` right before `</body>` in `prototypes/index.html`**

```html
<script>
(function () {
  var token = localStorage.getItem('pb_auth') || '';
  if (!token) { location.href = '/login'; return; }
  var authHeader = { 'Authorization': token };
  var configId = null;

  function fileFromHref(href) {
    return (href || '').split('/').pop().split('?')[0].split('#')[0];
  }

  function goLogin() {
    localStorage.removeItem('pb_auth');
    location.href = '/login';
  }

  function markCurrent(current) {
    document.querySelectorAll('a.card').forEach(function (card) {
      var file = fileFromHref(card.getAttribute('href'));
      var existing = card.querySelector('.live-badge');
      if (existing) existing.remove();
      var btn = card.querySelector('.make-current');
      if (file === current) {
        var preview = card.querySelector('.preview');
        if (preview) {
          var b = document.createElement('span');
          b.className = 'live-badge';
          b.textContent = '★ LIVE — сейчас на сайте';
          b.style.cssText = 'position:absolute;top:14px;left:50%;transform:translateX(-50%);z-index:4;background:#16a34a;color:#fff;font-size:10px;letter-spacing:.12em;text-transform:uppercase;padding:5px 12px;border-radius:9999px;font-weight:600;white-space:nowrap';
          preview.appendChild(b);
        }
        if (btn) { btn.textContent = 'Текущая ✓'; btn.disabled = true; }
      } else if (btn) {
        btn.textContent = 'Сделать текущей';
        btn.disabled = false;
      }
    });
  }

  async function setCurrent(file) {
    if (!configId) return;
    var res = await fetch('/api/collections/site_config/records/' + configId, {
      method: 'PATCH',
      headers: Object.assign({ 'Content-Type': 'application/json' }, authHeader),
      body: JSON.stringify({ current_version: file })
    });
    if (res.status === 401 || res.status === 403) { goLogin(); return; }
    if (!res.ok) { alert('Не удалось переключить версию'); return; }
    markCurrent(file);
  }

  async function load() {
    var res = await fetch('/api/collections/site_config/records?perPage=1', { headers: authHeader });
    if (res.status === 401 || res.status === 403) { goLogin(); return; }
    var data = await res.json();
    var rec = data.items && data.items[0];
    if (!rec) return;
    configId = rec.id;
    markCurrent(rec.current_version);
  }

  // Inject a "make current" button into each version card.
  document.querySelectorAll('a.card').forEach(function (card) {
    var file = fileFromHref(card.getAttribute('href'));
    if (!/\.html$/.test(file)) return;
    var btn = document.createElement('button');
    btn.className = 'make-current';
    btn.type = 'button';
    btn.textContent = 'Сделать текущей';
    btn.style.cssText = 'margin:0 24px 22px;padding:10px 16px;border:1px solid #cdb88a;background:transparent;color:#cdb88a;border-radius:6px;cursor:pointer;font:inherit;align-self:flex-start';
    btn.addEventListener('click', function (ev) {
      ev.preventDefault();
      ev.stopPropagation();
      setCurrent(file);
    });
    card.appendChild(btn);
  });

  load();
})();
</script>
```

- [ ] **Step 2: Verify the gallery still renders and contains the new script** (served only with a cookie)

```bash
TOKEN=$(curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s --cookie "pb_auth=$TOKEN" http://localhost:8080/prototypes/ | grep -c "make-current"
```
Expected: non-zero (script present in served gallery).

- [ ] **Step 3: Verify the switch API path works end to end (simulating the button)**

```bash
CID=$(curl -s --cookie "pb_auth=$TOKEN" -H "Authorization: $TOKEN" \
  "http://localhost:8080/api/collections/site_config/records?perPage=1" | python3 -c 'import sys,json;print(json.load(sys.stdin)["items"][0]["id"])')
# switch to a different version
curl -s -X PATCH "http://localhost:8080/api/collections/site_config/records/$CID" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"current_version":"aurora-v15a.html"}' -o /dev/null -w "patch: %{http_code}\n"
# root must now serve v15a (its DE/EN multilingual marker), then switch back
curl -s http://localhost:8080/ | grep -ci "v15\|RU · DE · EN\|multilingual" 
curl -s -X PATCH "http://localhost:8080/api/collections/site_config/records/$CID" \
  -H "Authorization: $TOKEN" -H 'Content-Type: application/json' \
  -d '{"current_version":"aurora-v16a.html"}' -o /dev/null -w "restore: %{http_code}\n"
```
Expected: `patch: 200`, the middle grep returns non-zero (root changed to v15a), `restore: 200`. If the content-grep is flaky, instead compare `curl -s http://localhost:8080/ | md5sum` before/after the switch and confirm it changes.

- [ ] **Step 4: Verify an anonymous PATCH is rejected**

```bash
curl -s -X PATCH "http://localhost:8080/api/collections/site_config/records/$CID" \
  -H 'Content-Type: application/json' -d '{"current_version":"aurora-v15a.html"}' \
  -o /dev/null -w "anon patch: %{http_code}\n"
```
Expected: `400`/`403` (not `200`).

- [ ] **Step 5: Commit**

```bash
git add prototypes/index.html
git commit -m "feat(gallery): auth guard, LIVE badge, one-click switch of current version"
```

---

## Task 8: Remove obsolete root redirect + full smoke + cleanup

**Files:**
- Delete: `index.html` (old meta-refresh redirect to /prototypes/, no longer used)

- [ ] **Step 1: Remove the old root index**

```bash
git rm index.html
```
(The compose mount for it was already removed in Task 2.)

- [ ] **Step 2: Recreate the stack from scratch and run the full smoke sequence**

```bash
docker compose down
docker compose up -d --build
docker compose exec pocketbase /pb/pocketbase superuser upsert admin@test.local Test12345! >/dev/null
TOKEN=$(curl -s -X POST http://localhost:8080/api/collections/_superusers/auth-with-password \
  -H 'Content-Type: application/json' \
  -d '{"identity":"admin@test.local","password":"Test12345!"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')

echo -n "root live:        "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/
echo -n "asset public:     "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/assets/logo.png
echo -n "login public:     "; curl -s -o /dev/null -w "%{http_code}\n" http://localhost:8080/login
echo -n "gallery no auth:  "; curl -s -o /dev/null -w "%{http_code}->%{redirect_url}\n" http://localhost:8080/prototypes/
echo -n "raw proto no auth:"; curl -s -o /dev/null -w "%{http_code}->%{redirect_url}\n" http://localhost:8080/prototypes/aurora-v15a.html
echo -n "gallery w/ auth:  "; curl -s -o /dev/null -w "%{http_code}\n" --cookie "pb_auth=$TOKEN" http://localhost:8080/prototypes/
echo -n "form create:      "; curl -s -o /dev/null -w "%{http_code}\n" -X POST http://localhost:8080/api/collections/requests/records -H 'Content-Type: application/json' -d '{"request_type":"smoke","email":"x@y.z"}'
```
Expected:
```
root live:        200
asset public:     200
login public:     200
gallery no auth:  302->http://localhost:8080/login
raw proto no auth:302->http://localhost:8080/login
gallery w/ auth:  200
form create:      200
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: drop obsolete root redirect; finalize live-version + gated gallery"
```

- [ ] **Step 4: Update deployment docs** (`docs/DEPLOYMENT.md`)

Add a short "Production setup after first deploy" note:
- Create the PocketBase superuser at `/_/` (this is also the gallery login).
- `/` serves the current version; manage which version is live from `/prototypes/` after logging in at `/login`.

```bash
git add docs/DEPLOYMENT.md
git commit -m "docs: document login + live-version switching"
```

---

## Deploy (after the plan is implemented and approved)

This is **not** an implementation task — do it only when the user asks to ship.

- Push `main`; GitHub Actions auto-deploys (`docker compose up -d --build`), applying the new migration on PocketBase start.
- On the server, the existing superuser doubles as the gallery login. If none exists yet, create it via `/_/` or `docker compose exec pocketbase /pb/pocketbase superuser upsert <email> <password>`.
- Verify against `https://events-luzern.ch/` (root), `/login`, `/prototypes/`.

---

## Self-Review (completed by plan author)

**Spec coverage:**
- Routing table (spec §1/§5) → Task 5.
- `site_config` + seed (spec §1) → Task 1.
- Resolver `/` + prototypes mount (spec §2a/§3) → Tasks 2, 3.
- Auth gate (spec §2b) → Task 4 (+ Caddy forward_auth in Task 5).
- Superuser login (spec §4) → Task 6.
- Gallery LIVE badge + switch + guard (spec §6) → Task 7.
- Login page (spec §7) → Task 6.
- Security boundary (spec §Безопасность): admin-only `site_config` (Task 1 Step 4, Task 7 Step 4), gated raw prototypes (Task 5 Step 5), path-traversal guard (Task 3 `isSafeVersionName`).
- Verification suite (spec §Проверка) → Task 8 Step 2.
- Out-of-scope items honored (no editors collection, no on-site version label, no static regen).

**Placeholder scan:** No "TBD"/"add error handling"/"similar to" — all steps carry concrete code/commands and expected outputs. Two flagged runtime confirmations (`$os.readFile` in Task 3, token type in Task 4) are framed as "make the curl check pass," with the verification that exercises them — not vague placeholders.

**Type/name consistency:** `pb_auth` cookie (Tasks 4,5,6,7); `current_version` field (Tasks 1,3,7); `site_config` collection (Tasks 1,3,7); `/pb-gate` route (Tasks 4,5); `_superusers/auth-with-password` (Tasks 6,7,8); `.make-current` / `.live-badge` classes (Task 7); `PROTOTYPES_DIR=/pb/prototypes` matches the compose mount (Task 2).
