# Кастомная админка Events.Luzern — дизайн

Дата: 2026-06-11

## Цель

Удобная админка для Натали в визуальном стиле лендинга (Aurora), поверх той
же базы PocketBase. Заменяет «работу руками в БД» через `/_/` человеческим
интерфейсом. Стандартная PB-админка `/_/` **остаётся** параллельно.

Первый объём: (1) управление заявками по категориям, (2) редактирование
содержимого письма с реквизитами оплаты с живым превью.

## Не входит (YAGNI)

- Настройка визуального оформления письма (логотип/цвета/шапка) — потом.
- Произвольная рассылка/переписка с клиентом из админки — потом.
- Управление версиями лендинга / maintenance — это уже есть в галерее.
- Аналитика, экспорт, роли — не нужно.

## Доступ и размещение

- Новый раздел по пути **`/admin/`**, гейтится так же, как `/prototypes/`:
  `login.html` логинит как PocketBase-суперюзер → cookie `pb_auth` (+ localStorage)
  → Caddy `forward_auth` на `/pb-gate` (уже существует).
- Если токена нет — редирект на `/login`. `login.html` поддержит `?next=`
  (по умолчанию `/prototypes/`); из галереи добавить ссылку на `/admin/`.
- Токен суперюзера даёт полный доступ к `/api` (минует collection rules) —
  достаточно для чтения/правки `requests` и `payment_settings`, загрузки QR.

## Технологии

- Статика без сборки: `admin/index.html` + `admin/admin.css` + `admin/admin.js`.
- Чистый JS + `fetch` к `/api`. Никаких фреймворков и build-шага (как вся репа).
- Caddy: новый гейтнутый `handle /admin/*` (forward_auth `/pb-gate`,
  `root /srv/site`, `file_server`); смонтировать `./admin` в caddy read-only,
  как уже сделано для `./prototypes`. SPA-роутинг — хэшем (`#/tickets` и т.п.),
  чтобы не настраивать серверные пути.

## Изменения в БД

Схему по максимуму НЕ трогаем. Единственное добавление (одобрено):

- Миграция: добавить в `requests` автодатное поле **`created`** (AutodateField,
  onCreate). Аддитивно, ничего не ломает. Старые 7 записей будут без даты —
  это допустимо (для них показываем «—»). Новые — с датой/временем.

`payment_settings` используется как есть (`intro_ru/de/en`, `bank_transfer`,
`twint`, `qr_code`). Поле `status` в `requests` уже есть — переиспользуем.

## Категории заявок

Различаются полем `requests.request_type`. Четыре страницы (вкладки), на каждой
показываем только релевантные поля:

| Страница | `request_type` | Поля на карточке |
|---|---|---|
| Билеты | `ticket` | event_name, event_date, tickets_count, цена + сумма (price × tickets_count), name, email, phone, language, message |
| Членство | `resident` | name, email, phone, message |
| Спикеры | `speaker` | name, email, phone, message (тема) |
| Партнёры | `partner` | name, email, phone, message (предложение) |

**Важно про членство:** форма резидента на лендинге **складывает** профессию,
интересы, «откуда узнала», желание выступать и пожелания в одно поле `message`
строками вида `Profession: …`, `Community interests: …`, `Heard from: …`,
`Speaker interest: …`, `Wishes or ideas: …`. Отдельных колонок в БД нет (и не
добавляем). Админка показывает `message` как форматированный многострочный блок;
по желанию — мягко парсит эти известные метки в подписи для красоты, но источник
один — `message`.

## Статусы

Хранятся в существующем строковом поле `status`. Начальное значение `new`
(ставит фронт лендинга).

- **Билеты:** `new` → `paid` → `confirmed` → `cancelled`
  (Новая → Оплачено → Подтверждено → Отменено)
- **Членство / Спикеры / Партнёры:** `new` → `handled` → `cancelled`
  (Новая → Обработана → Отменено)

Смена статуса = `PATCH /api/collections/requests/records/{id}` с `{status}`.
В UI — пилюли/кнопки доступных переходов для категории.

## Поведение страниц заявок

- Загрузка: `GET /api/collections/requests/records?filter=request_type='X'`
  `&sort=-created&perPage=200` (с токеном в `Authorization`).
- Фильтр по статусу (чипы сверху), поиск по name/email (клиентский).
- Карточка: бейдж статуса (цвет), кнопки доступных переходов, кнопка «Удалить»
  (`DELETE`, с подтверждением).
- Бейдж «новых» в сайдбаре = кол-во записей категории со `status='new'`.
- Сортировка по `-created` (свежие сверху); записи без `created` — в конце.

## Страница «Письмо с оплатой»

- Слева форма по полям `payment_settings` (одна запись): редакторы текстов
  `intro_ru/de/en`, `bank_transfer` (многострочный), `twint` (строка),
  загрузка `qr_code` (файл, превью + удалить).
- Справа **живой превью письма** — рендерит то же, что собирает хук
  `main.pb.js`: картинка-пример события сверху, текст из `intro_<lang>` с
  подставленными примерами `{event}` / `{tickets}` / `{total}`, блок способов
  оплаты (только заполненные: банк/TWINT/QR), подпись. Переключатель ru/de/en.
- QR в превью и в реальном письме — с публичного домена `https://events-luzern.ch`
  (как уже в хуке).
- Сохранение = `PATCH /api/collections/payment_settings/records/{id}`; загрузка
  QR — multipart на тот же record.
- Важно: HTML превью должен совпадать с тем, что реально шлёт хук, чтобы «как
  вижу — так и придёт». Логику сборки письма держать в одном месте JS.

## Стиль (токены Aurora)

- Фон `--bg:#0a0d2e`, глубже `--bg-deep:#06091e`, мягче `--bg-soft:#11163a`,
  доп. `--bg-aux:#1a1f4a`.
- Золото `--gold:#cdb88a`, ярче `--gold-bright:#e0cda3`; текст `--cream:#ece5d3`,
  приглушённый `rgba(236,229,211,.6)`; линии `rgba(236,229,211,.08/.18)`.
- Шрифты: Cormorant Garamond (заголовки), Inter (текст, вес 300).
- Кнопки-пилюли (gold / glass), uppercase + letter-spacing, стеклянные карточки
  с лёгким blur — как на лендинге.

## Структура файлов

```
admin/
  index.html     # каркас: сайдбар + контейнер страниц
  admin.css      # токены Aurora + компоненты (карточки, пилюли, формы)
  admin.js       # роутинг (хэш), загрузка/рендер заявок, статусы, email-страница + превью
backend/pb_migrations/
  20260611xxxxxx_requests_created.js   # добавить autodate `created`
Caddyfile        # + handle /admin/* (gated)
docker-compose.yml  # + монтирование ./admin в caddy
login.html       # + поддержка ?next=
prototypes/index.html  # + ссылка на /admin/
```

## Используемые API

- `POST /api/collections/_superusers/auth-with-password` (логин, уже есть).
- `GET /api/collections/requests/records?filter=&sort=-created&perPage=`
- `PATCH /api/collections/requests/records/{id}` (статус)
- `DELETE /api/collections/requests/records/{id}`
- `GET /api/collections/payment_settings/records` (одна запись)
- `PATCH /api/collections/payment_settings/records/{id}` (контент + QR multipart)

## Деплой

Push в `main` → авто-деплой (VPS 88.99.85.240, `/opt/events_luzern`). Миграция
`created` применится при рестарте PB. Визуальное — предпросмотр локально
(`python3 -m http.server`) перед пушем.
