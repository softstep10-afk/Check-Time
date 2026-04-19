# План внедрения фич из старого HTML

Источник: `OLD_APP_FINDINGS.md` (20 пунктов). Все эти фичи есть в старом HTML, но отсутствуют или неполны в новой Next.js версии.

Ниже — группировка по волнам. Принцип: каждая волна ≤ 60 минут работы Claude Code, связанные пункты в одной волне, миграции БД идут блоками (не по одной).

---

## 🧩 Прежде чем начать следующие волны

Сначала должны завершиться **уже запущенные**:

- **Волна 2.5** (сейчас выполняется) — REG-2 менеджерский `/tasks`, REG-3 дубль «ЧАСЫ»
- **Деплой edge function** — `supabase functions deploy detect-store-visit` (1 команда)
- **Webhook в Supabase Dashboard** — 1 ручной шаг в UI на `worker_live_locations` INSERT

После этого Волна 2 закрыта полностью, можно браться за новое.

---

## 🌊 Волна 3 — Worker essentials

**Что делает:** доводит рабочий интерфейс (то, что видит работник с телефона) до уровня старого HTML.

**Пункты OLD_APP_FINDINGS:** #1, #5, #9, #15

### Что входит

1. **«Before You Leave» — обязательный видео-чекаут**
   - Добавить поле `require_video: boolean default false` в таблицу `workers`
   - UI: toggle в форме редактирования работника (только менеджер) — «Требовать видео при чекауте»
   - На worker Check Out button: если `require_video=true` и сегодня ещё нет видео-события — кнопка заблокирована + заголовок «Before You Leave», запись/загрузка короткого видео
   - После успешной загрузки — разблокировать Check Out
   - Колонка ВИДЕО в Team таблице: зелёный кружок если сегодня загружено, пустой если нет

2. **Journal работника** — дополнить существующую вкладку
   - В старом HTML: renderJournal, captureJournalMedia, Save to Journal
   - Текущая вкладка «ЖУРНАЛ» в worker shell вероятно частично есть после Волны 2.5 (REG-3 правит таббар)
   - Проверить что работает: добавление фото/видео/заметки в дневник дня, просмотр предыдущих дней, менеджер видит в хронологии

3. **Worker browsing other projects while checked in**
   - Уже в смене на проекте А → открывает проект Б → видит его детали, карту, задачи
   - Check Out кнопка видна **только** на «своём» активном проекте (tracked by `last_proj_id`)
   - На других проектах — только «Назад» и просмотр

4. **Cancel — stay checked in**
   - В модалке Check Out рядом с кнопкой «Check Out» добавить «Отмена — остаться в смене»
   - Жмёт — модалка закрывается, смена продолжается, ничего не пишется в БД

### Миграции
```sql
alter table public.workers
  add column if not exists require_video boolean not null default false;
```

### Промпт для Claude Code (вставлять когда Волна 2.5 + деплой edge function закончатся)

```
Task: Wave 3 — Worker essentials from OLD_APP_FINDINGS.md

Goal: bring worker-side UI up to old HTML parity. Four pieces:

1. Before You Leave — mandatory video on checkout
   - Add workers.require_video boolean column (migration file in supabase/migrations/00006, "RUN MANUALLY" header, DO NOT auto-apply)
   - Add toggle "Require video at check-out" in manager's edit-worker form
   - On worker's Check Out tap: if require_video=true AND no video event today, show "Before You Leave" screen — record/upload short video, then enable Check Out
   - Team table VIDEO column: green filled circle if today has video, hollow otherwise (currently hollow for everyone)

2. Verify Journal tab works end-to-end (already exists in worker shell from Wave 2.5)
   - Adding photo/video/note to today's journal
   - Viewing past days
   - Manager seeing journal entries in timeline / worker profile
   - Fix whatever is broken or missing

3. Worker can browse other projects while still checked in
   - Currently if checked in on project A, going to project B probably breaks. Implement: keep check-in state, show project B details in read-only. Check Out button visible only on the active project (track by workers.last_proj_id).
   - "Back to my project" button if browsing elsewhere

4. Cancel stay checked in
   - In Check Out modal, add secondary button "Cancel — stay checked in" (RU: "Отмена — остаться в смене")
   - Clicking closes modal, keeps the shift active, writes nothing

Rules:
- Branch wave3/worker-essentials
- Commit per piece
- Migration 00006 as a file with commented SQL + "RUN MANUALLY" header, don't apply
- tsc + lint clean
- i18n EN + RU for all new strings
- Verify: full worker flow on desktop at /worker (AUTH_BYPASS=true)
```

**Размер:** ~50 минут, 1 миграция (применяю я руками через Supabase).

---

## 🌊 Волна 4 — Pay models

**Что делает:** добавляет 3 модели оплаты вместо только почасовой. Это самая большая и рискованная волна, потому что переделывает логику Payroll.

**Пункт OLD_APP_FINDINGS:** #2

### Что входит

1. **Миграция БД**
   ```sql
   -- 00007_pay_models.sql
   create type pay_model as enum ('hourly', 'fixed_amount', 'fixed_per_project');
   
   alter table public.workers
     add column if not exists pay_model pay_model not null default 'hourly',
     add column if not exists fixed_amount numeric(10,2),
     add column if not exists fixed_per_project jsonb default '{}';
   -- fixed_per_project = {"project_uuid_1": 500.00, "project_uuid_2": 1200.00}
   ```

2. **UI — форма работника**
   - Радио-группа: ⚪ Почасовая / ⚪ Фикс. сумма / ⚪ Фикс. за проект
   - Hourly → поле «Ставка, $/час»
   - Fixed amount → поле «Фикс. сумма, $» (выплачивается за период)
   - Fixed per project → выбор проекта + сумма для каждого (список добавлений)

3. **Payroll Calculator — три ветки расчёта**
   - Hourly: как сейчас, OT по >40h/нед × 1.5
   - Fixed amount: в период — выплата = fixed_amount, часы не при чём (только для справки)
   - Fixed per project: за каждый проект, где работник был в период — прибавить соответствующую сумму из `fixed_per_project` JSON

4. **Team — колонка «Ставка»**
   - Hourly: `$25/hr`
   - Fixed: `$500 / период`
   - Per project: `Per project` (кликом — попап со списком сумм)

5. **Reports**
   - В Annual Report разделить total paid по моделям

### Промпт для Claude Code

```
Task: Wave 4 — three pay models (hourly / fixed / per-project)

Currently all workers are assumed hourly. Old HTML supports three models (OLD_APP_FINDINGS.md #2). Implement.

1. Migration 00007_pay_models.sql (commented, RUN MANUALLY):
   - create type pay_model as enum ('hourly', 'fixed_amount', 'fixed_per_project')
   - alter workers: add pay_model default 'hourly', fixed_amount numeric, fixed_per_project jsonb default '{}'

2. Worker edit form: radio group (Hourly / Fixed amount / Fixed per project) + conditional fields
   - Hourly: existing hourly_rate field
   - Fixed: fixed_amount field ($/period)
   - Per project: list of rows (project dropdown + amount), adds to fixed_per_project JSON

3. Payroll calculator: three branches keyed on pay_model
   - hourly: existing OT math (>40h/wk × 1.5)
   - fixed_amount: gross = fixed_amount, regardless of hours (hours shown for reference only)
   - fixed_per_project: for each project worker touched in period, add amount from fixed_per_project[project_id]

4. Team table Rate column: show "$25/hr", "$500/period", or "Per project" (clickable → popover with project breakdown)

5. Annual report: split total paid by pay model in the aggregations

Rules:
- Branch wave4/pay-models
- One commit per numbered item above
- Migration file committed but not applied
- Extensive types: PayModel union, new fields in Worker type
- Payroll tests manual: create 3 test workers each on different model, run calc, verify totals
- tsc + lint clean, i18n EN + RU
```

**Размер:** ~60 минут. 1 миграция. Рискованно — трогает payroll, который сейчас работает.

---

## 🌊 Волна 5 — Hours admin

**Что делает:** улучшения для менеджера в работе с часами и зарплатой.

**Пункты OLD_APP_FINDINGS:** #8, #11, #16, #17

### Что входит

1. **Adjust Hours — чекбокс «Показать работнику»**
   - В модалке: ± часы, причина (required), чекбокс «Показать эту причину работнику» (default on)
   - Если on → работник видит заметку в своей истории часов
   - Если off → только менеджер видит

2. **Reset Hours to Zero**
   - Отдельная кнопка в worker detail: «🔄 Обнулить часы»
   - С подтверждением в модалке
   - Для конца расчётного периода — когда часы выплачены и надо стартовать с нуля

3. **Bulk Payroll operations**
   - В Payroll период: чекбоксы перед каждым работником
   - Кнопки «Выбрать всех» / «Обработать выбранных»

4. **Day Detail drill-down**
   - Клик на день в истории работника → модалка: когда пришёл, когда вышел, все чеки/фото/видео/задачи за день

### Миграции
Нет. Это UI + использование существующих событий.

### Промпт для Claude Code

```
Task: Wave 5 — Hours admin improvements

OLD_APP_FINDINGS.md #8, #11, #16, #17. No DB changes, all UI.

1. Adjust Hours modal: add "Show this note to worker" checkbox (default on)
   - Reason field is already there. New checkbox controls whether the reason text is visible in worker's own hours view.
   - Store the checkbox value in the event's metadata (jsonb) so the worker view can filter.

2. Reset Hours to Zero button on worker detail
   - Separate from Adjust Hours. Button: "🔄 Обнулить часы" / "Reset Hours to Zero"
   - Click → confirmation modal "Это действие обнулит текущие неоплаченные часы…"
   - On confirm: write an adjustment event that zeroes out the unpaid balance, with reason "Period closed, hours paid"

3. Bulk Payroll select + process
   - In the Payroll calculator per-worker table, add checkboxes in the first column
   - "Выбрать всех" / "Select All" header checkbox
   - "Обработать выбранных" button that approves/marks-paid only checked rows

4. Day Detail drill-down
   - Worker hours list (in worker profile timeline) — click any row → modal
   - Modal shows: Check-In time / Check-Out time / duration / all events in that day (photos, videos, task completions, messages) chronologically

Branch wave5/hours-admin, commit per piece. i18n, tsc, lint.
```

**Размер:** ~45 минут. Без миграций.

---

## 🌊 Волна 6 — Project enrichments

**Что делает:** улучшает работу с проектами — настройки, копирование, авто-координаты.

**Пункты OLD_APP_FINDINGS:** #4, #7, #13, #20

### Что входит

1. **GPS Radius per-project**
   - Миграция: `alter projects add column gps_radius_m int not null default 75`
   - В форме создания/редактирования проекта — поле «Радиус геозоны, м» (ползунок 25-300)
   - Check-in/out логика читает per-project значение, а не глобальное
   - Fallback к `app_settings.geofence_radius_meters` если поле null

2. **Copy Project**
   - Кнопка «📋 Копировать проект» в карточке проекта (отдельно от «копировать адрес»)
   - Клонирует: название (+ суффикс «(копия)»), адрес, lat/lng, hourly_rate, gps_radius_m, notes
   - НЕ копирует: смены, задачи, медиа, чеки

3. **«Использовать моё местоположение»**
   - В форме создания проекта рядом с полями lat/lng — кнопка 📍
   - Запрашивает геолокацию браузера, заполняет поля
   - Также можно обновить адрес через reverse geocoding (если есть API)

4. **Form parity check**
   - Пройтись по формам создания проекта и работника
   - Сверить с placeholders из старого HTML (список в OLD_APP_FINDINGS.md #20)
   - Добавить недостающие поля если есть

### Миграции
```sql
-- 00008_project_gps_radius.sql
alter table public.projects
  add column if not exists gps_radius_m int not null default 75
  check (gps_radius_m between 25 and 300);
```

### Промпт для Claude Code

```
Task: Wave 6 — Project enrichments

OLD_APP_FINDINGS.md #4, #7, #13, #20.

1. Migration 00008_project_gps_radius.sql (RUN MANUALLY)
   - alter projects add gps_radius_m int not null default 75 check (between 25 and 300)

2. Project edit form: GPS radius slider (25–300m, default 75, step 5)
   - Shown in create + edit forms
   - Tooltip: "На каком расстоянии от объекта можно сделать чекин"

3. Check-in logic reads per-project gps_radius_m, falls back to app_settings.geofence_radius_meters if null

4. Copy Project button on project card
   - Separate from "Copy address"
   - Opens confirm: "Копировать проект [name]?"
   - On confirm: inserts new project with name + " (копия)" and fields copied: address, lat, lng, hourly_rate, gps_radius_m, notes. Does NOT copy: shifts, tasks, media, receipts.

5. "Use my current location" button in project create form
   - Icon 📍 next to lat/lng fields
   - Uses navigator.geolocation.getCurrentPosition, fills lat + lng
   - Bonus: reverse geocode address if Google Maps API key is set in env

6. Form parity check
   - Compare project create/edit form with OLD_APP_FINDINGS.md §20 placeholders
   - Add any missing fields. Today's missing: GPS Radius (covered above), possibly Start Date (already present per Wave 1.5)

Branch wave6/project-enrichments, commit per piece. i18n, tsc, lint.
```

**Размер:** ~50 минут. 1 миграция.

---

## 🌊 Волна 7 — Messaging polish

**Что делает:** 4 цвета сообщений + приоритеты + режим уведомлений у работника.

**Пункты OLD_APP_FINDINGS:** #6, #14

### Что входит

1. **4 цвета сообщений**
   - Миграция: `alter messages add column priority message_priority`
   - enum: `urgent` (🔴), `info` (🟡), `good` (🟢), `task` (🔵)
   - В форме отправки менеджером — выбор цвета
   - В инбоксе работника — карточки окрашены по priority
   - Сортировка: urgent сверху, потом info, good, task

2. **«Read — will do later»**
   - На карточке сообщения у работника — вторая кнопка рядом с «Прочитано»
   - «📖 Прочту позже» — остаётся в инбоксе, но уровень «прочитано» false, счётчик уменьшается

3. **notif_mode у работника**
   - Миграция: `alter workers add column notif_mode text default 'sound'`
   - Enum-like: `sound` / `silent`
   - Работник в своём профиле может переключать
   - UI работника уважает: если silent — не играет звук при чекине/чекауте/сообщении

### Миграции
```sql
-- 00009_message_priority.sql
create type message_priority as enum ('urgent', 'info', 'good', 'task');
alter table public.messages
  add column if not exists priority message_priority default 'info';

alter table public.workers
  add column if not exists notif_mode text not null default 'sound'
  check (notif_mode in ('sound', 'silent'));
```

### Промпт для Claude Code

```
Task: Wave 7 — Messaging polish

OLD_APP_FINDINGS.md #6 and #14.

1. Migration 00009_message_priority.sql (RUN MANUALLY):
   - create type message_priority enum ('urgent', 'info', 'good', 'task')
   - alter messages add priority default 'info'
   - alter workers add notif_mode text check in ('sound','silent') default 'sound'

2. Manager message-to-worker form: add 4 radio buttons for priority
   - 🔴 Urgent / 🟡 Info / 🟢 Good / 🔵 Task
   - Default: Info

3. Worker inbox: card color by priority (red/yellow/green/blue tint)
   - Sort: urgent first, then info, good, task, each by timestamp desc

4. Worker inbox card actions: "Прочитано" and "📖 Прочту позже"
   - Прочитано: sets read_at timestamp, removes from unread count
   - Прочту позже: keeps in inbox, does NOT mark read. A different styling (e.g., struck-through preview).

5. Worker profile: toggle "Беззвучный режим" / "Silent mode" reads/writes workers.notif_mode
   - When silent: no sound on check-in, check-out, or new message
   - When sound: existing behavior

Branch wave7/messaging, commit per piece. i18n, tsc, lint.
```

**Размер:** ~45 минут. 1 миграция.

---

## 🌊 Волна 8 — Reliability & polish

**Что делает:** надёжность (offline), UX-мелочи, проверки.

**Пункты OLD_APP_FINDINGS:** #3, #10, #12, #18, #19

### Что входит

1. **Offline upload queue**
   - На worker client-side: если `navigator.onLine=false`, фото/видео/комменты попадают в localStorage-очередь `cc_offline_uploads`
   - При возврате online — авто-попытка загрузить
   - UI: значок «офлайн» + счётчик pending
   - Ограничение: файлы > 10 MB сохраняются только как превью (полный файл просят перезагрузить)

2. **STORAGE_LIMITS_MB клиентская валидация**
   - Хардкод: `{ photo: 20, video: 500, pdf: 50 }`
   - В компоненте загрузки — проверка размера и MIME перед отправкой
   - Toast с понятной ошибкой: «Фото слишком большое. Макс 20 МБ»

3. **Пресеты диапазонов дат**
   - В Timeline, Annual Report, Payroll — кнопки: «2 недели» / «3 месяца» / «Месяц» / «Год» / «Свой период»
   - Некоторые из этих уже есть после Волны 1.5 (payroll), нужна сверка и унификация

4. **Фильтр медиа Photos/Videos/PDFs**
   - На странице проекта во вкладке «Фото и видео» — 3 таба: Все / 📷 Фото / 🎥 Видео / 📄 PDF
   - По клику фильтрует список

5. **Voice input coverage audit**
   - Пройтись по всем текстовым полям и проверить что у них есть VoiceInput компонент
   - Где отсутствует (какие-то формы из Волн 1-2 могли пропустить) — добавить

### Миграции
Нет. Чистая клиентская работа.

### Промпт для Claude Code

```
Task: Wave 8 — Reliability & polish

OLD_APP_FINDINGS.md #3, #10, #12, #18, #19. No DB changes.

1. Offline upload queue
   - Worker client: if navigator.onLine=false, photos/videos/comments go to localStorage key "cc_offline_uploads" (JSON array)
   - On window 'online' event: auto-retry uploads from the queue
   - UI: small status widget in worker shell "Офлайн — в очереди N файлов"
   - Files > 10 MB: store only preview (thumbnail + metadata), prompt user to re-select actual file when online

2. STORAGE_LIMITS_MB client validation in all upload controls
   - const STORAGE_LIMITS_MB = { photo: 20, video: 500, pdf: 50 }
   - const MIMES = { photo: [jpeg, png, webp, heic, heif, gif], video: [mp4, quicktime, webm, avi], pdf: [application/pdf] }
   - Before upload: check size + MIME, toast error with clear message if over limit

3. Date range presets — unify across Timeline, Annual Report, Payroll
   - 6 buttons: "Сегодня" / "Неделя" / "2 недели" / "Месяц" / "3 месяца" / "Год" / "Свой период"
   - Shared component <DateRangePresets />, uses URL query params so state survives reload

4. Media type filter in project Photos & Videos tab
   - Tabs: Все / 📷 Фото / 🎥 Видео / 📄 PDF
   - Filters the existing media list

5. Voice input audit
   - Grep all <input type="text"> and <textarea> in worker and manager forms
   - Ensure VoiceInput component is present where text entry is expected
   - Add where missing

Branch wave8/reliability, commit per piece. i18n, tsc, lint.
```

**Размер:** ~55 минут. Без миграций.

---

## 🌊 Волна 9 — Final polish + real-world testing

**Что делает:** последние штрихи и настоящий тест на устройстве.

### Что входит

1. **Real-device testing**
   - Зайти с iPhone/Android на localhost через LAN IP (нужно настроить `next dev -H 0.0.0.0`)
   - Прогнать: логин работника, чекин, фото, видео, чекаут, Journal, сообщения
   - Собрать баги

2. **Consent form rollout**
   - Распечатать `GPS_CONSENT_FORM.md`
   - Подписать с реальными работниками до первого боевого чекина

3. **Bugs backlog**
   - Всё что всплывёт на реальном устройстве — отдельные микро-волны по мере необходимости

---

## 📊 Итоговая таблица

| Волна | Что | Размер | Миграция | Риск |
|-------|-----|--------|----------|------|
| 3 | Worker essentials (Before You Leave, Journal, Cancel, Browse) | 50 мин | 00006 | средний |
| 4 | Pay models (Hourly / Fixed / Per-Project) | 60 мин | 00007 | **высокий** — трогает payroll |
| 5 | Hours admin (Adjust show-to-worker, Reset, Bulk, Day Detail) | 45 мин | нет | низкий |
| 6 | Project enrichments (GPS radius, Copy, Use My Location) | 50 мин | 00008 | низкий |
| 7 | Messaging polish (4 цвета, Read later, notif_mode) | 45 мин | 00009 | низкий |
| 8 | Reliability (offline, limits, presets, media filter, voice) | 55 мин | нет | низкий |
| 9 | Real-device testing + consent rollout | часы | нет | реальный мир |

**Всего:** ~5 часов работы Claude Code + 4 миграции + моя рука на Supabase Dashboard + реальный тест.

---

## 🎯 Рекомендуемый порядок

**Вариант A — «безопасный»** (если хочется быстро стабилизировать):
3 → 5 → 6 → 7 → 8 → 4 → 9

Pay models (4) идут предпоследними, потому что они самые рискованные. Накануне релиза — уже знаешь что остальное работает.

**Вариант B — «ценность максимум»** (если нужны крупные фичи быстро):
3 → 4 → 6 → 7 → 5 → 8 → 9

Pay models сразу после Worker essentials — это самая ценная бизнес-фича, чем раньше тем лучше.

**Моя рекомендация — вариант A.** Pay models меньшего размера не становятся, а риск сломать работающий payroll — высокий. Хочется подойти к ним со стабильной кодовой базой.

---

## ⚙️ Операционные правила

Одинаковые для всех волн:

- **Ветки:** `waveN/short-name`, мерж в main когда Андрей подтверждает
- **Коммиты:** один на каждый пункт волны
- **Проверки перед коммитом:** `tsc --noEmit` чистый, `npm run lint` без новых ошибок
- **Миграции:** всегда отдельный файл в `supabase/migrations/`, с шапкой `RUN MANUALLY`, **не применять** из Claude Code — я применяю сам через Supabase SQL Editor (через Chrome extension)
- **i18n:** EN + RU для всех новых строк, никакого hardcoded текста
- **Промпт:** короткий (как Волна 2.5 — 10-15 строк), без лишних правил — Claude Code уже знает конвенции проекта
- **Не трогать:** DB auth flow, RLS поли́сы без явного запроса, payroll в волнах где не про payroll

---

## 📌 Зависимости между волнами

- **Волна 4 (pay models) после Волны 3** — чтобы Journal/Before You Leave уже работали до изменений в workers
- **Волна 6 (GPS radius per-project) после деплоя edge function** — чтобы edge function читала новое поле
- **Волна 9 (real testing) последней** — нет смысла тестировать неполный функционал
- Остальные волны независимы, можно тасовать

---

## 🗂️ Что обновлять по ходу

После каждой волны:
- `AUDIT_REPORT.md` → добавить секцию «Wave N — что закрыто» с хешами коммитов
- `PROGRESS_LOG.md` → обновить статус (✅ готово / ⏸️ в процессе / 📋 план)
- `OLD_APP_FINDINGS.md` → вычеркнуть (~~strikethrough~~) закрытые пункты

Эти 3 файла — наша память между сессиями. При потере контекста (сжатие чата или новый чат) я читаю их и продолжаю.


---

# 🛡️ Security & Access Model (новые волны X1-X5)

Обсуждено с Андреем 19.04.2026 после Волны 6. Цель — гибкая система доступов: каждому человеку свои права, анонимные репорты, приватность фото по проектам, отдельная роль для клиентов.

**Ключевые требования:**
1. Я (Owner) могу в любой момент менять галочки «кому что доступно» — флексибельно
2. Анонимный репорт — UI нейтральный (не «донести»), даже сам инициатор не ощущает акт доноса
3. Фото в проекте видят **все, кто назначен на этот проект** (не «только свои» — а «только своего проекта»)
4. Работник видит все действующие проекты на карте + список поставщиков
5. Клиенты — позже, отдельная роль с урезанным доступом к своему проекту

**Подход:** `user_capabilities` таблица как layer ПОВЕРХ ролей. Роль задаёт дефолт, capabilities — override per-user.

---

## 🌊 Волна X1 — User Capabilities (гибкие права)

**Миграция 00010** (пример):
```sql
create table public.user_capabilities (
  user_id uuid references public.profiles(id) on delete cascade,
  capability text not null,
  granted boolean not null default true,
  granted_by uuid references public.profiles(id),
  granted_at timestamptz not null default now(),
  primary key (user_id, capability)
);

-- capabilities are string keys matching the permissions matrix:
-- 'view_payroll', 'see_all_projects', 'upload_receipts',
-- 'view_supply_stores', 'send_messages', 'force_checkout', ...
```

**UI:** страница `/admin/users/[id]/permissions` с чекбоксами всех capabilities. Галка — capability granted: true. Снятая — granted: false. Отсутствие записи — fallback на роль.

**Helper:** `has_capability(user, cap)` RLS-функция — возвращает `user_capabilities.granted` если есть, иначе дефолт по роли.

**Риск:** высокий (меняем RLS). ~60 мин. Миграция 00010.

---

## 🌊 Волна X2 — Photo privacy по проекту

**Что:** работник видит фото **только тех проектов где он в `project_assignments`**. Менеджер/Owner — всё.

**RLS изменение:** политика `media.select` — проверка `project_assignments.worker_id = auth.uid() AND project_id = media.project_id` для worker role. Manager/Owner обходят.

**Без новой таблицы.** ~30 мин. Миграция 00011 (только RLS, без schema).

---

## 🌊 Волна X3 — Anonymous reports (нейтральный репорт)

**UI:** у каждого фото в ленте — кнопка **«🚩 Отметить для проверки»** (нейтральная). Работник нажимает → менеджер получает уведомление + флаг на фото. Другие работники флаг не видят. В БД инициатор записывается, но в UI всем видно только «помечено».

**Таблица:**
```sql
create table public.media_flags (
  media_id uuid references public.media(id) on delete cascade,
  flagged_by uuid references public.profiles(id),
  flagged_at timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by uuid references public.profiles(id),
  primary key (media_id)
);
```

**RLS:** только Owner/Manager читают `flagged_by`. Работники видят только агрегат «помечено: да/нет» (через view).

**Риск:** средний. ~45 мин. Миграция 00012.

---

## 🌊 Волна X4 — Client role

**Новая роль** в enum: `client`. Доступ:
- Видит только свои проекты (через `project_assignments` с role=client)
- Видит прогресс, фото, чеки, часы (aggregate)
- **НЕ видит** зарплаты, других клиентов, внутренние сообщения

**Invite flow:** менеджер создаёт клиент-профиль с email → Supabase отправляет magic link → клиент входит.

**Риск:** высокий (новая роль, новый RLS контур). ~90 мин. Миграция 00013.

**Зависимость:** требует X1 (user_capabilities) для гибкости — какому клиенту что показывать.

---

## 🌊 Волна X5 — Worker map + supply stores picker

**UI-only.**

1. **Global projects map** для работника — отдельный раздел «Все объекты». Видит маркеры всех действующих проектов компании на карте. Клик → детали проекта (read-only).

2. **Supply stores picker** — работник в своём интерфейсе может посмотреть список поставщиков (Home Depot, Lowe's и т.д.), выбрать куда ехать. Использует существующую `supply_stores`.

**Миграций нет.** ~40 мин.

---

## 📋 Обновлённый порядок волн

**С учётом X-волн:**

**Рекомендация:**
```
3.5 (сейчас) → 7 → 8 → X1 → X2 → X3 → X5 → 4 → X4 → 9
```

**Обоснование:**
- **3.5 → 7 → 8** — сначала закрыть hardening и простые UI (messaging, offline)
- **X1 → X2 → X3** — базовая security-model (гибкие права, приватность, репорты). X1 первый, потому что остальные опираются на capabilities
- **X5** — работник-центричные фичи (карта, поставщики). Лёгкий перерыв перед тяжёлой X4
- **4** — pay models после того как security стабильна (payroll RLS может зависеть от capabilities)
- **X4** — клиенты последние, требуют всей инфраструктуры
- **9** — real-device testing

---

## 📊 Итоговая таблица (обновлена)

| # | Волна | Миграция | Размер | Риск |
|---|-------|----------|--------|------|
| 3.5 | Prod readiness (middleware+tests+CI+README) | нет | 40 мин | низкий |
| 7 | Messaging polish | 00009 | 45 мин | низкий |
| 8 | Reliability | нет | 55 мин | низкий |
| X1 | User capabilities | 00010 | 60 мин | **высокий** — RLS |
| X2 | Photo privacy by project | 00011 (RLS) | 30 мин | средний |
| X3 | Anonymous media flags | 00012 | 45 мин | средний |
| X5 | Worker map + stores picker | нет | 40 мин | низкий |
| 4 | Pay models | 00007 | 60 мин | **высокий** — payroll |
| X4 | Client role | 00013 | 90 мин | **высокий** — новая роль |
| 9 | Real-device testing | нет | часы | реальный мир |

**Всего после 3.5:** ~8 часов работы + 5 миграций.
