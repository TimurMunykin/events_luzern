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

function wireActions() {} // replaced in Task 6

ROUTES.email = function () { view.innerHTML = '<div class="empty">Скоро…</div>'; };

render();
