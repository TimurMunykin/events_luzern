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
