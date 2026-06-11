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

render();

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
