# Итерация 17 — правки Натали + видео в архиве (8 вариантов раскладки)

**Дата:** 2026-06-07
**Статус:** дизайн утверждён, готов к плану
**База:** `prototypes/aurora-v16a.html` (не трогаем — итерации копятся)

## Цель

Применить правки Натали к лендингу и встроить два вертикальных промо-ролика (Christmas, Easter) в архив прошедших событий. Сделать **8 вариантов** (`aurora-v17a.html` … `aurora-v17h.html`), различающихся только раскладкой архива; общие правки идентичны во всех. Натали выберет вариант, переключив боевую версию в `/prototypes/`.

## Часть A — общие правки (идентичны во всех 8 вариантах)

### A1. Раздел членства: «Резидент» → «Стать частью Events.Luzern»
- Заголовок секции (`#member`, ~строки 806–808 в v16a):
  - RU: «Стать частью Events.Luzern»
  - DE: «Teil von Events.Luzern werden»
  - EN: «Become part of Events.Luzern»
- Подпись под заголовком (~809–811): «Присоединяйся к комьюнити Events.Luzern» / DE «Werde Teil der Events.Luzern Community» / EN «Join the Events.Luzern community».
- Кнопка открытия модалки (~837–839) и заголовок модалки (~888–889):
  - RU: «Присоединиться» · DE: «Jetzt beitreten» · EN: «Join us»
  - (убрать «(бесплатно)/(kostenlos)/(free)» из подписи кнопки; факт бесплатности остаётся в тексте «closing».)
- Навигация (строка 417) и футер-ссылка (868): RU label «Сообщество» (DE «Mitgliedschaft», EN «Membership»), anchor `#member` без изменений.
- Перки (список `<li>` ~819–830): оставить ровно 4, в этом порядке и тексте:
  1. RU «Приоритетная регистрация на все мероприятия за 48–72 часа до открытия продаж со скидкой 10% на билеты» / DE «Bevorzugte Anmeldung zu allen Events 48–72 Stunden vor Verkaufsstart, mit 10% Rabatt auf Tickets» / EN «Priority registration for all events 48–72 hours before sales open, with 10% off tickets»
  2. RU «Закрытый Telegram-чат комьюнити» / DE «Geschlossener Telegram-Community-Chat» / EN «Private Telegram community chat»
  3. RU «Ранние анонсы — раньше всех» / DE «Frühe Ankündigungen — vor allen anderen» / EN «Early announcements — before everyone else»
  4. RU «Эксклюзивные мини-события только для участников» / DE «Exklusive Mini-Events nur für Mitglieder» / EN «Exclusive mini-events for members only»
  - Удалить перк «Member Spotlight в Instagram» (строки 823–825) и «Доступ в закрытый чат…» дубль, если перекрывается пунктом 2 (свести к одному).

### A2. Убрать «женское» → «комьюнити Events.Luzern»
Заменить формулировки сообщества (НЕ описания конкретных прошлых событий):
- Hero-подзаголовок (451–453): RU «Комьюнити Events.Luzern» / DE «Events.Luzern Community» / EN «Events.Luzern community».
- Подпись членства (809–810) — см. A1 (уже нейтральная).
- Текст «body» членства (813–814): убрать гендерную привязку («Frauen…») → нейтрально про людей/комьюнити.
- «closing» (833–834): «…ощущение принадлежности к тёплому женскому кругу» → «…к тёплому комьюнити Events.Luzern»; DE аналогично («…gemütlichen Frauenkreises» → «…Events.Luzern Community»).
- Форма, вопрос 5 (899): «в нашем женском комьюнити» → «в нашем комьюнити»; чекбокс «женская энергия» (903) → «Поддержка и тёплая атмосфера» (DE/EN).
- НЕ трогаем описания событий «Летний аромат»/«RE:FRESH» (566–567, 740–741) — это фактические описания тех мероприятий.

### A3. Убрать отдельную рассылку, опт-ин — галочкой в форме
- Удалить секцию newsletter целиком: блок ~846–854 (eyebrow + форма `data-request-form="newsletter"`), относящиеся CSS если уникальны, и JS-обработчик `[data-request-form="newsletter"]` (1229–1236). Строки `newsletterSuccess` оставить можно (не мешают) или удалить.
- В форме вступления чекбокс `newsletter_opt_in` (947) — текст:
  - RU «Хочу получать анонсы на email» · DE «Ich möchte Ankündigungen per E-Mail erhalten» · EN «I want to receive announcements by email»
  - оставить `checked` по умолчанию.

### A4. Реальные отзывы (3 шт.)
Заменить три `.testimonial` (762–764). 5 звёзд сохранить. Тексты (RU исходник + перевод DE/EN):
1. RU «Натали вложила в каждую деталь столько тепла и внимания — это чувствовалось с первой минуты. Вдохновляющий опыт!» — «Татьяна и Аделина»
   DE «Natali hat in jedes Detail so viel Wärme und Aufmerksamkeit gelegt — das war von der ersten Minute an spürbar. Eine inspirierende Erfahrung!» — «Tatjana & Adelina»
   EN «Natali put so much warmth and attention into every detail — you felt it from the first minute. An inspiring experience!» — «Tatiana & Adelina»
2. RU «Тепло, вдохновение и творческая энергия — всё в одном вечере. Буду возвращаться снова!» — «Светлана»
   DE «Wärme, Inspiration und kreative Energie — alles an einem Abend. Ich komme wieder!» — «Swetlana»
   EN «Warmth, inspiration and creative energy — all in one evening. I'll be back!» — «Svetlana»
3. RU «Организация безупречная, атмосфера тёплая, мастер-класс профессиональный. Вы принесли рождественское настроение прямо в наши сердца!» — «Кармен»
   DE «Perfekte Organisation, herzliche Atmosphäre, professioneller Workshop. Ihr habt die Weihnachtsstimmung direkt in unsere Herzen gebracht!» — «Carmen»
   EN «Flawless organization, warm atmosphere, professional master class. You brought the Christmas spirit straight into our hearts!» — «Carmen»
- `who` = имена (без «постоянная гостья» и т.п., если Натали даёт только имена; можно оставить как имя + 🤍 опустить, эмодзи не в uppercase-стиле — имена капсом по текущему стилю `.who`).

### A5. Цветные иконки соцсетей в контактах
- В блоке контактов (874–875) иконки Instagram сделать брендовыми: Instagram — фирменный розово-оранжево-фиолетовый градиент (через `linear-gradient` + `background-clip:text` или цветная svg-заливка). Если присутствуют Telegram/WhatsApp/Email — Telegram `#229ED9`, WhatsApp `#25D366`, email — gold. Сохранить аккуратность относительно тёмной темы; ховер оставить.

### A6. Видео (общий ассет для всех вариантов)
- Источники: `~/Downloads/IMG_8391.MOV` (Christmas, HEVC 1080×1920 60fps 55s 124MB), `~/Downloads/IMG_8422.MOV` (Easter, 50s 113MB).
- Пережать в веб-MP4 H.264:
  - `scale=720:1280` (сохранить 9:16), `fps=30`, `libx264 -profile:v high -crf 28 -preset slow`, аудио `aac -b:a 96k`, `-movflags +faststart`. Цель ≤ ~5 МБ каждый.
- Постеры: кадр ~1–2 сек, `-q:v 3` JPG.
- Пути (в существующих папках событий):
  - Christmas → `prototypes/assets/past/christmas-master-class/reel.mp4` + `reel-poster.jpg`
  - Easter → `prototypes/assets/past/easter-master-class/reel.mp4` + `reel-poster.jpg`
- Ассеты коммитятся (папка `prototypes/assets` не в .gitignore).

### A7. Поведение видео
- В ленте: `autoplay muted loop playsinline` (без звука).
- По клику: открывается со звуком — через существующий `#gallery-lightbox` (там `<video controls>`), либо разворот карточки со снятием `muted`. Использовать существующий лайтбокс-механизм, где возможно.

## Часть B — 8 вариантов раскладки архива (`#past`)

Во всех вариантах: у Easter и Christmas фото-мини-галерея заменяется на вертикальный ролик; **RE:FRESH** (ролика нет) сохраняет свою мини-галерею, стилистически вписанную в вариант.

- **v17a — Split (чередование):** ролик с одной стороны (≈360–420px ширины), текст события — с другой; следующая карточка зеркально. Классика, спокойно.
- **v17b — Cinematic full-card:** ролик фоном карточки (object-fit:cover, ограниченная высота), затемняющий градиент, текст и CTA поверх снизу.
- **v17c — Reels-ряд (stories):** карточки-сторис в ряд (3-up на desktop, скролл на мобайле), компактные вертикальные превью; тап → лайтбокс со звуком.
- **v17d — Центр + подпись снизу:** крупный вертикальный ролик по центру колонки, заголовок/описание под ним; минимализм, много воздуха.
- **v17e — Poster wall:** сетка постеров (обложек) событий; клик по постеру открывает ролик со звуком в лайтбоксе. Самый «лёгкий» визуально.
- **v17f — Карусель reels:** горизонтальная карусель вертикальных роликов со снап-скроллом и стрелками; текст события над/под активным.
- **v17g — Hover/tap-expand:** компактные вертикальные превью, на ховере (desktop) подрастают/подыгрывают, по клику — лайтбокс со звуком.
- **v17h — Sticky storytelling:** ролик «прилипает» (position:sticky) сбоку, пока рядом скроллится текст события (editorial-подача).

## Часть C — галерея прототипов
В `prototypes/index.html` добавить блок «Итерация 17 · видео в архиве + правки Натали» с карточками `aurora-v17a.html` … `aurora-v17h.html` (стиль карточек как у текущих, бейдж текущей версии управляется логикой LIVE из v16-инфры). v16a и предыдущие не трогаем.

## Реализационная стратегия (для плана)
1. Пережать видео, сгенерировать постеры (один раз, общий ассет).
2. Собрать `aurora-v17a.html` = копия v16a + ВСЕ правки части A + раскладка архива A.
3. `aurora-v17b…h` = копии v17a, в каждой переписывается только секция `#past` (+ её CSS) под соответствующий вариант.
4. Обновить галерею.

## Проверка (локально, без передеплоя; визуальные правки — превью перед пушем)
- `python3 -m http.server` в `prototypes/`, открыть каждый `aurora-v17x.html`: видео грузится/играет без звука, по клику — со звуком; в архиве у Easter/Christmas ролики, RE:FRESH с галереей.
- Проверить три языка (RU/DE/EN) в изменённых блоках.
- Размер каждого `reel.mp4` ≤ ~5 МБ.
- Прогнать CI-проверку ассетов (как в `.github/workflows/deploy.yml`) для каждого v17x: инлайн-скрипт парсится, нет битых ссылок на `assets/...`.
- Никаких изменений в `aurora-v16a.html` и более ранних.

## Вне области (YAGNI)
- Не меняем функционал форм/PocketBase (поля те же; `newsletter_opt_in` уже есть).
- Не трогаем hero-видео и фото About.
- Не правим описания конкретных прошлых/будущих событий (кроме формулировок «комьюнити»).
- CI-проверка прибита к `aurora-v16a.html` — оставляем (не мешает); при желании обновим отдельно.
