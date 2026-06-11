# Кастомная админка Events.Luzern — план реализации

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Админка в стиле лендинга (Aurora) на `/admin/` поверх той же PocketBase: страницы заявок по категориям со статусами + редактор письма с реквизитами с живым превью.

**Architecture:** Статика без сборки (`admin/index.html` + `admin.css` + `admin.js`), хэш-роутинг, общается с PocketBase `/api` токеном суперюзера. Гейтится через существующий `/pb-gate` (Caddy `forward_auth`). Одно аддитивное изменение БД — autodate-поле `created` в `requests`.

**Tech Stack:** Vanilla JS + fetch, PocketBase 0.35 (JSVM-миграции), Caddy, Docker Compose. Без npm/сборки. Шрифты Cormorant Garamond + Inter (Google Fonts, как на лендинге).

Спека: `docs/superpowers/specs/2026-06-11-admin-panel-design.md`.

---

## Локальная среда (нужна для проверки задач 2–8)

Запуск локального стека (PocketBase :8090 внутри сети + Caddy на http://localhost:8080):

```bash
cd /mnt/2ff8307b-9b5b-4fa5-8217-119c66b5f2ae/repo/events_luzern
docker compose up -d --build
# создать локального суперюзера для входа:
docker compose exec pocketbase /pb/pocketbase superuser upsert admin@local.test 'localpass123'
```

Логин локально: открыть http://localhost:8080/login , ввести `admin@local.test` / `localpass123`.
Гейт `/pb-gate` примет токен суперюзера и пустит на `/prototypes/` и (после задачи 2) `/admin/`.

Если в локальной `data/pocketbase` нет коллекций `requests`/`payment_settings` — они создадутся
из миграций при `up`. Засеять пару тестовых заявок (см. Task 5, Step 1).

Остановить: `docker compose down`.

---

## Файлы

```
backend/pb_migrations/20260611210000_requests_created.js   # Task 1 (создать)
Caddyfile                                                  # Task 2 (изменить)
docker-compose.yml                                         # Task 2 (изменить)
login.html                                                 # Task 2 (изменить)
prototypes/index.html                                      # Task 2 (изменить — ссылка на /admin)
admin/index.html                                           # Task 3 (создать)
admin/admin.css                                            # Task 3 (создать)
admin/admin.js                                             # Task 4–8 (создать, дополняется)
```

---

## Task 1: Миграция — поле `created` в `requests`

**Files:**
- Create: `backend/pb_migrations/20260611210000_requests_created.js`

- [ ] **Step 1: Написать миграцию**

```javascript
migrate(function (app) {
  // Additive: timestamp for sorting requests by recency in the custom admin.
  // Existing records get no value (admin shows "—" for them); new records auto-fill.
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.add(new AutodateField({
    name: "created",
    onCreate: true,
    onUpdate: false
  }));
  app.save(requests);
}, function (app) {
  var requests = app.findCollectionByNameOrId("requests");
  requests.fields.removeByName("created");
  app.save(requests);
});
```

- [ ] **Step 2: Проверить миграцию в одноразовом контейнере** (не трогая локальные данные)

```bash
cd /mnt/2ff8307b-9b5b-4fa5-8217-119c66b5f2ae/repo/events_luzern/backend
docker build -t pb-migtest .
docker run --rm -v "$PWD/_migtest:/pb/pb_data" pb-migtest /pb/pocketbase migrate up 2>&1 | tail -20
docker run --rm -v "$PWD/_migtest:/pb/pb_data" pb-migtest \
  /pb/pocketbase migrate collections 2>/dev/null >/dev/null; echo "exit $?"
rm -rf "$PWD/_migtest"
```
Expected: миграция применяется без ошибок (видно `20260611210000_requests_created` в выводе up). Очистка `_migtest` обязательна.

- [ ] **Step 3: Commit**

```bash
cd /mnt/2ff8307b-9b5b-4fa5-8217-119c66b5f2ae/repo/events_luzern
git add backend/pb_migrations/20260611210000_requests_created.js
git commit -m "feat(admin): add created autodate field to requests"
```

---

## Task 2: Гейтинг `/admin/`, монтирование, login ?next, ссылка из галереи

**Files:**
- Modify: `Caddyfile`
- Modify: `docker-compose.yml`
- Modify: `login.html`
- Modify: `prototypes/index.html`
- Create (заглушка для проверки гейта): `admin/index.html`

- [ ] **Step 1: Caddyfile — добавить гейтнутый `/admin/*`**

Вставить блок ПЕРЕД `# Root: current live version` (рядом с `/prototypes/*`):

```
	# Gated custom admin (same superuser login as the gallery)
	handle /admin/* {
		forward_auth pocketbase:8090 {
			uri /pb-gate
		}
		root * /srv/site
		file_server
	}
```

- [ ] **Step 2: docker-compose.yml — смонтировать `./admin` в caddy**

В сервисе `caddy`, в списке `volumes`, после строки с `./prototypes:/srv/site/prototypes:ro` добавить:

```yaml
      - ./admin:/srv/site/admin:ro
```

- [ ] **Step 3: login.html — поддержать `?next=`**

Заменить строку `location.href = '/prototypes/';` на:

```javascript
    var next = new URLSearchParams(location.search).get('next') || '/prototypes/';
    // only allow same-origin relative paths
    location.href = next.charAt(0) === '/' && next.charAt(1) !== '/' ? next : '/prototypes/';
```

- [ ] **Step 4: prototypes/index.html — ссылка на админку**

Сразу после `<button id="siteToggle" ...>…</button>` (в `<header>`, ~строка 156) добавить:

```html
    <a href="/admin/" class="site-toggle" style="text-decoration:none">⚙ Админка</a>
```

- [ ] **Step 5: Заглушка admin/index.html (проверка гейта)**

```html
<!doctype html><html lang="ru"><head><meta charset="utf-8"><title>Admin</title></head>
<body style="background:#0a0d2e;color:#ece5d3;font-family:sans-serif">admin gate ok</body></html>
```

- [ ] **Step 6: Проверить гейт на локальном стеке**

```bash
docker compose up -d --build
# без логина — редирект на /login:
curl -s -o /dev/null -w "no-auth /admin/ -> %{http_code} %{redirect_url}\n" http://localhost:8080/admin/
```
Expected: `302` с редиректом на `/login`. Затем вручную: залогиниться на http://localhost:8080/login и открыть http://localhost:8080/admin/ → видно «admin gate ok».

- [ ] **Step 7: Commit**

```bash
git add Caddyfile docker-compose.yml login.html prototypes/index.html admin/index.html
git commit -m "feat(admin): gate /admin, mount admin dir, login ?next, gallery link"
```

---

## Task 3: Каркас админки — index.html + admin.css (сайдбар, токены Aurora)

**Files:**
- Modify: `admin/index.html` (заменить заглушку)
- Create: `admin/admin.css`

- [ ] **Step 1: admin/index.html — каркас**

```html
<!doctype html>
<html lang="ru" data-lang="ru">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Events.Luzern · Админка</title>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Inter:wght@300;400;500;600&display=swap" rel="stylesheet">
<link rel="stylesheet" href="admin.css" />
</head>
<body>
  <aside class="sidebar">
    <div class="brand"><span class="brand-mark">EL</span><span class="brand-name">Events.Luzern</span></div>
    <nav class="nav">
      <a class="nav-item" data-route="tickets">Билеты <span class="badge" data-badge="ticket"></span></a>
      <a class="nav-item" data-route="membership">Членство <span class="badge" data-badge="resident"></span></a>
      <a class="nav-item" data-route="speakers">Спикеры <span class="badge" data-badge="speaker"></span></a>
      <a class="nav-item" data-route="partners">Партнёры <span class="badge" data-badge="partner"></span></a>
      <a class="nav-item" data-route="email">Письмо с оплатой</a>
    </nav>
    <a class="nav-foot" href="/prototypes/">← К галерее</a>
  </aside>
  <main class="content" id="view"></main>
  <script src="admin.js"></script>
</body>
</html>
```

- [ ] **Step 2: admin/admin.css — токены Aurora + сайдбар + базовые компоненты**

```css
:root{
  --bg:#0a0d2e; --bg-deep:#06091e; --bg-soft:#11163a; --bg-aux:#1a1f4a;
  --gold:#cdb88a; --gold-bright:#e0cda3;
  --cream:#ece5d3; --muted:rgba(236,229,211,.6); --faint:rgba(236,229,211,.32);
  --line:rgba(236,229,211,.08); --line-strong:rgba(236,229,211,.18);
}
*{box-sizing:border-box}
html,body{margin:0;background:var(--bg);min-height:100vh}
body{color:var(--cream);font-family:'Inter',sans-serif;font-weight:300;font-size:15px;line-height:1.6;display:flex;-webkit-font-smoothing:antialiased}
h1,h2,h3,h4{font-family:'Cormorant Garamond',serif;font-weight:400;letter-spacing:-.005em;margin:0}
a{color:inherit;text-decoration:none}
::selection{background:var(--gold);color:var(--bg)}

/* sidebar */
.sidebar{width:248px;min-height:100vh;background:var(--bg-deep);border-right:1px solid var(--line);
  padding:28px 18px;display:flex;flex-direction:column;gap:8px;position:sticky;top:0}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:24px;padding:0 8px}
.brand-mark{width:34px;height:34px;border-radius:50%;background:var(--gold);color:var(--bg);
  display:grid;place-items:center;font-weight:600;font-size:13px}
.brand-name{font-family:'Cormorant Garamond',serif;font-size:19px}
.nav{display:flex;flex-direction:column;gap:4px}
.nav-item{display:flex;align-items:center;justify-content:space-between;padding:11px 14px;border-radius:9px;
  color:var(--muted);font-size:13px;letter-spacing:.04em;cursor:pointer;transition:all .25s}
.nav-item:hover{background:var(--bg-soft);color:var(--cream)}
.nav-item.on{background:var(--bg-soft);color:var(--gold)}
.badge{min-width:20px;height:20px;padding:0 6px;border-radius:9999px;background:var(--gold);color:var(--bg);
  font-size:11px;font-weight:600;display:none;place-items:center;line-height:20px;text-align:center}
.badge.show{display:inline-grid}
.nav-foot{margin-top:auto;padding:11px 14px;color:var(--faint);font-size:12px}
.nav-foot:hover{color:var(--gold)}

/* content */
.content{flex:1;padding:40px 48px;max-width:1100px}
.page-head{margin-bottom:28px}
.eyebrow{font-size:11px;text-transform:uppercase;letter-spacing:.34em;color:var(--gold)}
.page-head h1{font-size:34px;margin-top:6px}

/* toolbar */
.toolbar{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-bottom:22px}
.chip{padding:7px 15px;border-radius:9999px;border:1px solid var(--line-strong);background:transparent;
  color:var(--muted);font:inherit;font-size:12px;letter-spacing:.06em;cursor:pointer;transition:all .25s}
.chip.on{background:var(--gold);color:var(--bg);border-color:var(--gold)}
.search{flex:1;min-width:180px;padding:9px 14px;border-radius:9px;border:1px solid var(--line-strong);
  background:var(--bg-soft);color:var(--cream);font:inherit;font-size:13px}

/* cards */
.card{background:var(--bg-soft);border:1px solid var(--line);border-radius:14px;padding:20px 22px;
  margin-bottom:14px;backdrop-filter:blur(8px)}
.card-top{display:flex;justify-content:space-between;align-items:flex-start;gap:16px;margin-bottom:10px}
.card-title{font-family:'Cormorant Garamond',serif;font-size:21px}
.card-meta{color:var(--muted);font-size:13px;margin:2px 0}
.card-sum{color:var(--gold);font-size:15px;font-weight:500}
.kv{color:var(--muted);font-size:13px;margin:3px 0}
.kv b{color:var(--cream);font-weight:500}
.msg-block{white-space:pre-wrap;background:var(--bg);border:1px solid var(--line);border-radius:9px;
  padding:12px 14px;color:var(--muted);font-size:13px;margin-top:10px}
.date{color:var(--faint);font-size:12px}

/* status pills + action buttons */
.status{display:inline-flex;align-items:center;gap:6px;padding:4px 11px;border-radius:9999px;font-size:11px;
  letter-spacing:.08em;text-transform:uppercase;border:1px solid var(--line-strong)}
.status.new{color:var(--gold-bright);border-color:var(--gold)}
.status.paid{color:#7fc8a9}
.status.confirmed{color:#7fc8a9;border-color:#7fc8a9}
.status.handled{color:#7fc8a9;border-color:#7fc8a9}
.status.cancelled{color:#f0857d;border-color:rgba(240,133,125,.5)}
.actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:14px}
.btn{padding:8px 16px;border-radius:9999px;border:1px solid var(--line-strong);background:transparent;
  color:var(--cream);font:inherit;font-size:12px;letter-spacing:.08em;cursor:pointer;transition:all .25s}
.btn:hover{border-color:var(--gold);color:var(--gold)}
.btn-gold{background:var(--gold);color:var(--bg);border-color:var(--gold)}
.btn-gold:hover{background:var(--gold-bright);color:var(--bg)}
.btn-danger:hover{border-color:#f0857d;color:#f0857d}

/* empty / loading */
.empty{color:var(--faint);padding:48px 0;text-align:center;font-size:14px}

/* email page */
.email-grid{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start}
.field{margin-bottom:16px;display:flex;flex-direction:column;gap:6px}
.field label{font-size:12px;text-transform:uppercase;letter-spacing:.12em;color:var(--gold)}
.field input,.field textarea{padding:11px 14px;border-radius:9px;border:1px solid var(--line-strong);
  background:var(--bg-soft);color:var(--cream);font:inherit;font-size:14px;width:100%}
.field textarea{min-height:90px;resize:vertical}
.preview-pane{background:#ffffff;border-radius:14px;padding:8px;position:sticky;top:40px}
.preview-frame{background:#fff;border-radius:8px;overflow:hidden}
.lang-tabs{display:flex;gap:8px;margin-bottom:14px}
@media(max-width:900px){.email-grid{grid-template-columns:1fr}.sidebar{width:200px}}
```

- [ ] **Step 3: Проверить вид (без данных)**

```bash
node --check admin/index.html 2>/dev/null || true   # html не проверяется node; пропустить
docker compose up -d
```
Открыть http://localhost:8080/admin/ (после логина): виден тёмный сайдбар с золотыми пунктами и пустой контент. Это визуальная проверка.

- [ ] **Step 4: Commit**

```bash
git add admin/index.html admin/admin.css
git commit -m "feat(admin): Aurora-styled shell — sidebar nav + design tokens"
```

---

## Task 4: admin.js — auth, API-хелперы, хэш-роутер

**Files:**
- Create: `admin/admin.js`

- [ ] **Step 1: Написать ядро admin.js**

```javascript
'use strict';

// --- auth: superuser token from cookie/localStorage (set by login.html) ---
function getToken() {
  var m = document.cookie.match(/(?:^|;\s*)pb_auth=([^;]+)/);
  if (m) return decodeURIComponent(m[1]);
  return localStorage.getItem('pb_auth') || '';
}
var TOKEN = getToken();
if (!TOKEN) {
  location.href = '/login?next=' + encodeURIComponent('/admin/');
}

// --- API helpers (same-origin /api) ---
function api(path, opts) {
  opts = opts || {};
  opts.headers = Object.assign({ Authorization: TOKEN }, opts.headers || {});
  return fetch('/api' + path, opts).then(function (r) {
    if (r.status === 401 || r.status === 403) {
      location.href = '/login?next=' + encodeURIComponent('/admin/');
      throw new Error('unauthorized');
    }
    if (!r.ok) return r.text().then(function (t) { throw new Error(t || r.status); });
    return r.status === 204 ? null : r.json();
  });
}
function apiJson(path, method, body) {
  return api(path, {
    method: method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
}

function escapeHtml(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#039;');
}
function fmtDate(s) {
  if (!s) return '—';
  var d = new Date(s); if (isNaN(d)) return '—';
  return d.toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

// --- router ---
var view = document.getElementById('view');
var ROUTES = {}; // filled by later tasks: { tickets: fn, membership: fn, ... }

function setActiveNav(route) {
  document.querySelectorAll('.nav-item').forEach(function (el) {
    el.classList.toggle('on', el.getAttribute('data-route') === route);
  });
}
function render() {
  var route = (location.hash.replace('#/', '') || 'tickets');
  if (!ROUTES[route]) route = 'tickets';
  setActiveNav(route);
  view.innerHTML = '<div class="empty">Загрузка…</div>';
  ROUTES[route]();
}
window.addEventListener('hashchange', render);
document.querySelectorAll('.nav-item').forEach(function (el) {
  el.addEventListener('click', function () { location.hash = '#/' + el.getAttribute('data-route'); });
});

// placeholder until Task 5/7 register real routes:
['tickets','membership','speakers','partners','email'].forEach(function (r) {
  ROUTES[r] = function () { view.innerHTML = '<div class="empty">Скоро…</div>'; };
});

render();
```

- [ ] **Step 2: Проверить синтаксис**

```bash
node --check admin/admin.js && echo "SYNTAX OK"
```
Expected: `SYNTAX OK`.

- [ ] **Step 3: Проверить роутинг на стеке**

`docker compose up -d`; на http://localhost:8080/admin/ — клики по пунктам меню подсвечивают активный и показывают «Скоро…»; без токена (инкогнито) — редирект на /login.

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): auth guard, API helpers, hash router"
```

---

## Task 5: Страницы заявок — конфиг категорий и рендер списка

**Files:**
- Modify: `admin/admin.js`

- [ ] **Step 1: Засеять тестовые заявки локально** (для проверки)

```bash
B=http://localhost:8080
post(){ curl -s -o /dev/null -w "$1 %{http_code}\n" -X POST "$B/api/collections/requests/records" -H "Content-Type: application/json" -d "$2"; }
post ticket '{"request_type":"ticket","status":"new","language":"de","name":"Anna M","email":"anna@example.com","phone":"+41790000000","event_name":"Wine casino","event_date":"26 June","price":"CHF 95","tickets_count":"2","message":""}'
post resident '{"request_type":"resident","status":"new","name":"Lena K","email":"lena@example.com","phone":"","message":"Profession: Designer\nCommunity interests: Networking\nHeard from: Instagram\nSpeaker interest: Maybe\nWishes or ideas: more workshops"}'
post speaker '{"request_type":"speaker","status":"new","name":"Olga P","email":"olga@example.com","phone":"","message":"Тема: ароматерапия"}'
post partner '{"request_type":"partner","status":"new","name":"Studio X","email":"hi@studiox.ch","phone":"","message":"Хотим сотрудничать"}'
```

- [ ] **Step 2: Добавить конфиг категорий и общий рендер списка** (вставить в admin.js ПЕРЕД блоком placeholder-роутов; затем заменить placeholder-регистрацию)

```javascript
// --- request categories config ---
var STATUS_LABELS = {
  new: 'Новая', paid: 'Оплачено', confirmed: 'Подтверждено',
  handled: 'Обработана', cancelled: 'Отменено'
};
var CATEGORIES = {
  tickets:    { type: 'ticket',   title: 'Билеты',   eyebrow: 'Заявки · 01', flow: ['new','paid','confirmed','cancelled'] },
  membership: { type: 'resident', title: 'Членство', eyebrow: 'Заявки · 02', flow: ['new','handled','cancelled'] },
  speakers:   { type: 'speaker',  title: 'Спикеры',  eyebrow: 'Заявки · 03', flow: ['new','handled','cancelled'] },
  partners:   { type: 'partner',  title: 'Партнёры', eyebrow: 'Заявки · 04', flow: ['new','handled','cancelled'] }
};

function computeTotal(price, count) {
  var m = String(price || '').match(/[0-9]+([.,][0-9]+)?/);
  var n = parseInt(count, 10);
  if (!m || isNaN(n) || n <= 0) return '';
  var num = parseFloat(m[0].replace(',', '.'));
  if (isNaN(num)) return '';
  var cur = (String(price).match(/CHF|EUR|USD|€|\$/i) || ['CHF'])[0];
  var total = num * n;
  return cur + ' ' + (total % 1 === 0 ? total : total.toFixed(2));
}

// card body per category
function cardBody(cat, r) {
  if (cat.type === 'ticket') {
    var total = computeTotal(r.price, r.tickets_count);
    return '<div class="card-meta">' + escapeHtml(r.event_date) + ' · ' + escapeHtml(r.tickets_count) + ' билет(ов)' +
      (total ? ' · <span class="card-sum">' + escapeHtml(total) + '</span>' : '') + '</div>' +
      '<div class="kv"><b>' + escapeHtml(r.name) + '</b> · ' + escapeHtml(r.email) +
      (r.phone ? ' · ' + escapeHtml(r.phone) : '') + ' · ' + escapeHtml((r.language||'').toUpperCase()) + '</div>' +
      (r.message ? '<div class="msg-block">' + escapeHtml(r.message) + '</div>' : '');
  }
  // resident / speaker / partner
  return '<div class="kv"><b>' + escapeHtml(r.name) + '</b> · ' + escapeHtml(r.email) +
    (r.phone ? ' · ' + escapeHtml(r.phone) : '') + '</div>' +
    (r.message ? '<div class="msg-block">' + escapeHtml(r.message) + '</div>' : '');
}

function titleFor(cat, r) {
  if (cat.type === 'ticket') return escapeHtml(r.event_name || 'Билет');
  return escapeHtml(r.name || '—');
}

// shared list page
function makeRequestsPage(key) {
  return function () {
    var cat = CATEGORIES[key];
    var state = { filter: 'all', q: '' };
    api('/collections/requests/records?perPage=200&sort=-created&filter=' +
        encodeURIComponent("request_type='" + cat.type + "'"))
      .then(function (res) {
        var items = res.items || [];
        function draw() {
          var filtered = items.filter(function (r) {
            if (state.filter !== 'all' && r.status !== state.filter) return false;
            if (state.q) {
              var hay = (r.name + ' ' + r.email).toLowerCase();
              if (hay.indexOf(state.q.toLowerCase()) === -1) return false;
            }
            return true;
          });
          var chips = ['all'].concat(cat.flow).map(function (s) {
            var label = s === 'all' ? 'Все' : STATUS_LABELS[s];
            return '<button class="chip ' + (state.filter === s ? 'on' : '') + '" data-f="' + s + '">' + label + '</button>';
          }).join('');
          var cards = filtered.length ? filtered.map(function (r) {
            return '<div class="card" data-id="' + r.id + '">' +
              '<div class="card-top"><div><div class="card-title">' + titleFor(cat, r) + '</div></div>' +
              '<span class="status ' + r.status + '">' + (STATUS_LABELS[r.status] || r.status) + '</span></div>' +
              cardBody(cat, r) +
              '<div class="date">Заявка: ' + fmtDate(r.created) + '</div>' +
              '<div class="actions" data-actions></div>' +
              '</div>';
          }).join('') : '<div class="empty">Заявок нет</div>';
          view.innerHTML =
            '<div class="page-head"><div class="eyebrow">' + cat.eyebrow + '</div><h1>' + cat.title + '</h1></div>' +
            '<div class="toolbar">' + chips + '<input class="search" placeholder="Поиск по имени/email" value="' + escapeHtml(state.q) + '"></div>' +
            cards;
          // wire filters + search
          view.querySelectorAll('.chip').forEach(function (c) {
            c.addEventListener('click', function () { state.filter = c.getAttribute('data-f'); draw(); });
          });
          var s = view.querySelector('.search');
          if (s) s.addEventListener('input', function () { state.q = s.value; draw(); });
          wireActions(cat, items, draw); // defined in Task 6
        }
        draw();
      })
      .catch(function (e) { view.innerHTML = '<div class="empty">Ошибка: ' + escapeHtml(e.message) + '</div>'; });
  };
}

ROUTES.tickets = makeRequestsPage('tickets');
ROUTES.membership = makeRequestsPage('membership');
ROUTES.speakers = makeRequestsPage('speakers');
ROUTES.partners = makeRequestsPage('partners');
```

Также добавить временную заглушку `wireActions`, чтобы Task 5 проверялся до Task 6 (удалить в Task 6):

```javascript
function wireActions() {} // replaced in Task 6
```

Удалить старую строку, регистрировавшую `tickets/membership/speakers/partners` как placeholder (оставить placeholder только для `email`):

```javascript
ROUTES.email = function () { view.innerHTML = '<div class="empty">Скоро…</div>'; };
```

- [ ] **Step 3: Синтаксис + визуальная проверка**

```bash
node --check admin/admin.js && echo OK
```
На стеке: страница «Билеты» показывает карточку Anna M (Wine casino · 2 билета · CHF 190, статус Новая, дата). «Членство» — Lena K с раскрытым `message`. Фильтр-чипы и поиск работают.

- [ ] **Step 4: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): request list pages per category with filters and search"
```

---

## Task 6: Действия — смена статуса и удаление

**Files:**
- Modify: `admin/admin.js`

- [ ] **Step 1: Заменить заглушку `wireActions` на реальную реализацию**

Удалить `function wireActions() {}` и добавить:

```javascript
function nextActions(cat, status) {
  // available transitions from current status (exclude current)
  if (cat.type === 'ticket') {
    if (status === 'new') return ['paid', 'cancelled'];
    if (status === 'paid') return ['confirmed', 'cancelled'];
    if (status === 'confirmed') return ['cancelled'];
    if (status === 'cancelled') return ['new'];
  } else {
    if (status === 'new') return ['handled', 'cancelled'];
    if (status === 'handled') return ['cancelled'];
    if (status === 'cancelled') return ['new'];
  }
  return [];
}

function wireActions(cat, items, redraw) {
  view.querySelectorAll('.card').forEach(function (cardEl) {
    var id = cardEl.getAttribute('data-id');
    var rec = items.filter(function (x) { return x.id === id; })[0];
    if (!rec) return;
    var box = cardEl.querySelector('[data-actions]');
    var html = nextActions(cat, rec.status).map(function (s) {
      var gold = (s === 'paid' || s === 'confirmed' || s === 'handled');
      return '<button class="btn ' + (gold ? 'btn-gold' : '') + '" data-set="' + s + '">' + STATUS_LABELS[s] + '</button>';
    }).join('');
    html += '<button class="btn btn-danger" data-del="1">Удалить</button>';
    box.innerHTML = html;
    box.querySelectorAll('[data-set]').forEach(function (b) {
      b.addEventListener('click', function () {
        var s = b.getAttribute('data-set');
        b.disabled = true;
        apiJson('/collections/requests/records/' + id, 'PATCH', { status: s })
          .then(function () { rec.status = s; redraw(); })
          .catch(function (e) { alert('Ошибка: ' + e.message); b.disabled = false; });
      });
    });
    box.querySelector('[data-del]').addEventListener('click', function () {
      if (!confirm('Удалить заявку безвозвратно?')) return;
      api('/collections/requests/records/' + id, { method: 'DELETE' })
        .then(function () {
          var i = items.indexOf(rec); if (i >= 0) items.splice(i, 1);
          redraw();
        })
        .catch(function (e) { alert('Ошибка: ' + e.message); });
    });
  });
}
```

- [ ] **Step 2: Синтаксис + проверка действий**

```bash
node --check admin/admin.js && echo OK
```
На стеке: на карточке билета кнопки «Оплачено»/«Отменить»; клик «Оплачено» → статус меняется на Оплачено, появляются «Подтверждено»/«Отменить». «Удалить» с подтверждением убирает карточку. Перезагрузка страницы сохраняет изменения (PATCH ушёл в БД).

- [ ] **Step 3: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): status transitions and delete actions"
```

---

## Task 7: Страница «Письмо с оплатой» — форма + живой превью

**Files:**
- Modify: `admin/admin.js`

- [ ] **Step 1: Реализовать ROUTES.email** (заменить placeholder `ROUTES.email`)

Превью обязано совпадать с тем, что собирает хук `backend/pb_hooks/main.pb.js` (картинка-пример, intro с подстановками, блок способов оплаты, подпись). Порт логики:

```javascript
var EMAIL_L = {
  ru: { methods:'Способы оплаты', bank:'Банковский перевод', twint:'TWINT', qr:'QR-код', regards:'С уважением,<br>Events.Luzern' },
  de: { methods:'Zahlungsmethoden', bank:'Banküberweisung', twint:'TWINT', qr:'QR-Code', regards:'Mit freundlichen Grüssen,<br>Events.Luzern' },
  en: { methods:'Payment methods', bank:'Bank transfer', twint:'TWINT', qr:'QR code', regards:'Best regards,<br>Events.Luzern' }
};
var SAMPLE = { ru:{ev:'Винное казино'}, de:{ev:'Wein-Casino'}, en:{ev:'Wine casino'} };

function buildEmailHtml(p, lang) {
  var L = EMAIL_L[lang];
  var ev = SAMPLE[lang].ev, tickets = '2', total = 'CHF 190';
  var intro = String(p['intro_' + lang] || '')
    .replace(/\{event\}/g, escapeHtml(ev))
    .replace(/\{tickets\}/g, tickets)
    .replace(/\{total\}/g, escapeHtml(total));
  var heading = 'font-family:Arial,sans-serif;font-size:16px;margin:18px 0 6px;color:#1a1a2e';
  var methods = '';
  var bank = String(p.bank_transfer || '').trim();
  var twint = String(p.twint || '').trim();
  var qr = p.qr_code;
  if (bank) methods += '<h3 style="'+heading+'">'+L.bank+'</h3><div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5">'+bank+'</div>';
  if (twint) methods += '<h3 style="'+heading+'">'+L.twint+'</h3><p style="font-family:Arial,sans-serif;font-size:14px">'+escapeHtml(twint)+'</p>';
  if (qr) {
    var qrUrl = 'https://events-luzern.ch/api/files/payment_settings/' + p.id + '/' + qr;
    methods += '<h3 style="'+heading+'">'+L.qr+'</h3><p><img src="'+escapeHtml(qrUrl)+'" alt="QR" style="max-width:200px;height:auto"/></p>';
  }
  return '<div style="max-width:560px;margin:0 auto;font-family:Arial,sans-serif;color:#1a1a2e;padding:20px">' +
    '<div style="font-size:15px;line-height:1.6">' + intro + '</div>' +
    (methods ? '<h2 style="font-size:18px;margin:26px 0 4px;color:#1a1a2e">'+L.methods+'</h2>'+methods : '') +
    '<p style="margin-top:28px;color:#6b7280;font-size:13px">'+L.regards+'</p>' +
    '</div>';
}

ROUTES.email = function () {
  api('/collections/payment_settings/records?perPage=1')
    .then(function (res) {
      var p = (res.items || [])[0];
      if (!p) { view.innerHTML = '<div class="empty">Нет записи payment_settings</div>'; return; }
      var lang = 'ru';
      function draw() {
        view.innerHTML =
          '<div class="page-head"><div class="eyebrow">Письмо с оплатой</div><h1>Как выглядит письмо клиенту</h1></div>' +
          '<div class="email-grid">' +
            '<div>' +
              field('Текст RU','intro_ru',p.intro_ru,true) +
              field('Текст DE','intro_de',p.intro_de,true) +
              field('Текст EN','intro_en',p.intro_en,true) +
              field('Банковские реквизиты','bank_transfer',p.bank_transfer,true) +
              field('TWINT','twint',p.twint,false) +
              '<div class="field"><label>QR-код</label>' +
                (p.qr_code ? '<div class="kv">Загружен: '+escapeHtml(p.qr_code)+'</div>' : '<div class="kv">Не загружен</div>') +
                '<input type="file" id="qr-file" accept="image/png,image/jpeg,image/webp,image/svg+xml"></div>' +
              '<div class="actions"><button class="btn btn-gold" id="save">Сохранить</button>' +
              '<span class="kv" id="savemsg" style="align-self:center"></span></div>' +
            '</div>' +
            '<div><div class="lang-tabs">' +
              ['ru','de','en'].map(function(l){return '<button class="chip '+(l===lang?'on':'')+'" data-l="'+l+'">'+l.toUpperCase()+'</button>';}).join('') +
              '</div><div class="preview-pane"><div class="preview-frame">' + buildEmailHtml(p, lang) + '</div></div></div>' +
          '</div>';
        // live update of preview as text fields change
        ['intro_ru','intro_de','intro_en','bank_transfer','twint'].forEach(function (name) {
          var el = view.querySelector('[name="'+name+'"]');
          el.addEventListener('input', function () { p[name] = el.value; refreshPreview(); });
        });
        view.querySelectorAll('[data-l]').forEach(function (b) {
          b.addEventListener('click', function () { lang = b.getAttribute('data-l'); draw(); });
        });
        view.querySelector('#save').addEventListener('click', save);
      }
      function refreshPreview() {
        view.querySelector('.preview-frame').innerHTML = buildEmailHtml(p, lang);
      }
      function save() {
        var btn = view.querySelector('#save'); var msg = view.querySelector('#savemsg');
        btn.disabled = true; msg.textContent = 'Сохранение…';
        var fileEl = view.querySelector('#qr-file');
        var p1;
        if (fileEl.files[0]) {
          var fd = new FormData();
          ['intro_ru','intro_de','intro_en','bank_transfer','twint'].forEach(function(n){ fd.append(n, p[n] || ''); });
          fd.append('qr_code', fileEl.files[0]);
          p1 = api('/collections/payment_settings/records/' + p.id, { method: 'PATCH', body: fd });
        } else {
          p1 = apiJson('/collections/payment_settings/records/' + p.id, 'PATCH', {
            intro_ru:p.intro_ru, intro_de:p.intro_de, intro_en:p.intro_en, bank_transfer:p.bank_transfer, twint:p.twint
          });
        }
        p1.then(function (updated) { Object.assign(p, updated); msg.textContent = 'Сохранено ✓'; btn.disabled = false; draw(); })
          .catch(function (e) { msg.textContent = 'Ошибка: ' + e.message; btn.disabled = false; });
      }
      draw();
    })
    .catch(function (e) { view.innerHTML = '<div class="empty">Ошибка: ' + escapeHtml(e.message) + '</div>'; });
};

function field(label, name, value, multiline) {
  var control = multiline
    ? '<textarea name="'+name+'">'+escapeHtml(value)+'</textarea>'
    : '<input type="text" name="'+name+'" value="'+escapeHtml(value)+'">';
  return '<div class="field"><label>'+label+'</label>'+control+'</div>';
}
```

- [ ] **Step 2: Синтаксис + проверка**

```bash
node --check admin/admin.js && echo OK
```
На стеке: страница «Письмо с оплатой» — слева поля (intro ru/de/en, банк, TWINT, QR-upload), справа белый превью письма с подставленными «Wine casino / 2 / CHF 190». Правка текста в поле сразу меняет превью. Переключатель RU/DE/EN меняет язык превью. «Сохранить» шлёт PATCH (проверить: перезагрузка сохраняет). Загрузка QR появляется в превью.

- [ ] **Step 3: Commit**

```bash
git add admin/admin.js
git commit -m "feat(admin): payment email editor with live preview"
```

---

## Task 8: Бейджи «новых», финальная проверка, деплой

**Files:**
- Modify: `admin/admin.js`

- [ ] **Step 1: Заполнять бейджи «новых» в сайдбаре**

Добавить в конец admin.js (до `render();` перенести нельзя — вызвать после; оставить как отдельную функцию и вызвать):

```javascript
function refreshBadges() {
  ['ticket','resident','speaker','partner'].forEach(function (type) {
    api('/collections/requests/records?perPage=1&filter=' +
        encodeURIComponent("request_type='" + type + "' && status='new'"))
      .then(function (res) {
        var el = document.querySelector('[data-badge="' + type + '"]');
        if (!el) return;
        var n = res.totalItems || 0;
        el.textContent = n;
        el.classList.toggle('show', n > 0);
      }).catch(function () {});
  });
}
refreshBadges();
```

- [ ] **Step 2: Финальная сверка всего на локальном стеке**

Пройти все 5 страниц: заявки рисуются, фильтры/поиск/статусы/удаление работают, письмо редактируется и превью совпадает с реальным (сверить визуально с тем, что описано в хуке). Бейджи показывают число новых.

- [ ] **Step 3: Локальный предпросмотр стиля и финальный синтаксис**

```bash
node --check admin/admin.js && echo "JS OK"
docker compose down
```

- [ ] **Step 4: Commit + push (деплой)**

```bash
git add admin/admin.js
git commit -m "feat(admin): sidebar new-request badges"
git push origin main
```
После пуша — авто-деплой; миграция `created` применится при рестарте PB. Проверить на проде: `https://events-luzern.ch/admin/` под логином, и что письма по-прежнему уходят (хук не трогали).

---

## Самопроверка плана

- **Покрытие спеки:** доступ/гейт (T2), no-build статика (T3–4), 4 категории+поля (T5), статусы по категориям (T6), email-редактор+превью (T7), бейджи (T8), миграция created (T1), стиль Aurora (T3). Членство из `message` — учтено в `cardBody` (T5). ✓
- **Плейсхолдеры:** временный `wireActions(){}` в T5 явно заменяется в T6 — помечено. Других нет.
- **Согласованность имён:** `api/apiJson/escapeHtml/fmtDate/view/ROUTES/STATUS_LABELS/CATEGORIES/wireActions/buildEmailHtml/field/refreshBadges` — используются единообразно между задачами. `computeTotal` и поля payment_settings совпадают с хуком.
