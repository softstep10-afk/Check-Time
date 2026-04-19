# Construction Clock — Хронология работы

## ✅ Полностью завершено

### Фундамент БД
- **2-A** — миграция схемы: 8 таблиц (messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items) + роль `owner` в enum + колонки `start_date`/`end_date` у projects
- **2-B** — RLS: 27 политик на 8 таблицах, хелперы `is_owner()` / `is_manager()` обновлены
- Миграция лежит в `supabase/migrations/00003_schema_gap.sql`, применена через Supabase SQL Editor

### Wire-up кода к БД
- **2-C-1** — messages + audit_log + force-checkout notification
- **2-C-2** — GPS (watchPosition → worker_live_locations), consent в БД, живые маркеры на карте
- **2-C-3** — payroll: pay_periods + pay_period_items + adjustments persistence

### Волна 1 — 13 SAFE AUTO-FIX из AUDIT_REPORT.md
Ветка `wave1/safe-fixes`, коммитов: 13. Косметика, hydration, Projects traffic-lights, Team VIDEO/TOTAL/Actions, receipt rollup, dead code, перевод «Loading».

### Волна 1.5 — 4 доп. исправления из ручного обхода
Ветка `wave1.5/ui-polish`, 4 коммита:
- `f9ec00d` — localized DateField wrapper
- `e93d717` — payroll empty-state с preset quick-picks
- `413efee` — team roster cards → responsive table
- `ebc328c` — AUDIT_REPORT.md секция Wave 1.5

## ⏸️ В процессе

### Волна 2 — edge function автодетект магазинов
Ветка `wave2/geofence-function`. Из 7 подзадач:
- ✅ 1. detect-store-visit edge function (закоммичен: `1ece6f8`)
- ⬜ 2. Документация webhook setup
- ⬜ 3. Закрытие открытых store_visits при clock-out
- ⬜ 4. Файлы миграций grace_started_at + app_settings (комментом, НЕ применять)
- ⬜ 5. Owner UI: слайдер радиуса на /admin/settings
- ⬜ 6. store_visit events в Overview EventFeed
- ⬜ 7. Worker profile: визиты за неделю

## 📋 После Волны 2 — по порядку

1. **Маленький SQL-патч** — применение миграций grace_started_at + app_settings через Supabase SQL Editor (я делаю сам через Chrome)
2. **Настройка webhook в Supabase Dashboard** — 1 шаг в UI, подключить worker_live_locations INSERT → edge function URL
3. **Consent-форма на бумаге** — файл `GPS_CONSENT_FORM.md` готов, распечатать и подписать с работниками перед первым чекином в новой версии
4. **Визуальное тестирование** — force-checkout, вложения в messages, чеки по проектам, GPS с реального телефона
5. **Пройтись по `OLD_APP_FINDINGS.md`** — 20 фич из старого HTML, выбрать приоритеты:
   - П1: Before You Leave (видеочекаут), 3 модели оплаты, GPS radius per project, 4 цвета сообщений
   - П2: Offline queue, Journal, Copy project, Adjust hours «показать работнику»
   - П3: мелочи

## 🗂️ Ключевые файлы-артефакты

- `AUDIT_REPORT.md` — полный аудит от 2026-04-18, 34 проблемы, статусы обновлены волнами
- `OLD_APP_FINDINGS.md` — 20 фич из старого HTML, ранжированы по приоритету
- `GPS_CONSENT_FORM.md` — шаблон согласия EN+RU (этот файл делаем сейчас)
- `supabase/migrations/00003_schema_gap.sql` — схема, применена
- `supabase/functions/detect-store-visit/` — edge function Волны 2
- `docs/permissions.md` — матрица прав owner/manager/…

## 📐 Параметры проекта

- **Путь:** `C:\Users\Nwbui\Documents\Max start bad\check-time\check-time`
- **Supabase:** `vlrajjwbaxikbwvqdpft.supabase.co`
- **Dev:** `npm run dev` → `localhost:3000`
- **Claude Code:** `claude --dangerously-skip-permissions`
- **AUTH_BYPASS_ENABLED=true** — демо-режим с Owner по умолчанию


---

## 🔍 Ручной обход 19.04.2026 (после Волны 1.5, до окончания Волны 2)

### ✅ Подтверждено рабочим
- **Overview:** hydration-error исчез, консоль чистая, «1 issue» пропала
- **Overview:** появилась карточка «Материалы $0.00 по всем проектам» (receipt rollup — пункт 10 Волны 1)
- **Overview:** секция «Срочная очередь» с чипами URGENT/HIGH, «Загрузка проектов» с часами
- **Projects:** светофор 🟢🟡🔴, зелёная светящаяся рамка у активного, «+ Добавить проект», «📋 Копировать», бейдж ACTIVE
- **Projects:** даты с подписями «ДАТА НАЧАЛА» + «дд.мм.гггг» (пункт 2 Волны 1.5 — правильное решение)
- **Team:** полная таблица с всеми колонками (ИМЯ/РОЛЬ/СТАТУС/ЧАСЫ/СТАВКА/ЗАРАБОТАНО/ВИДЕО/ДЕЙСТВИЯ), строка ИТОГО (2 чел.): 4h 35m / $176.83, кнопки Edit/Msg/Remove
- **Payroll:** красивый empty-state с иконкой, 4 пресет-кнопки, «Новый период» (пункт 3 Волны 1.5)

### 🔴 РЕГРЕССИИ (починить после Волны 2)

#### REG-1: EventFeed пропал с Overview
При фиксе дубликата в Волне 1.5 (пункт 1) снесли оба экземпляра ленты, а должен был остаться один. Лента из 15 событий должна вернуться — это ядро Overview (задача 3 из плана).

**Где починить:** `src/app/(manager)/overview/page.tsx` — вернуть ровно ОДИН `<EventFeed events={feedEvents} />` в подходящую секцию (не в grid, а в основной surface-card).

#### REG-2: /tasks у менеджера показывает worker-view
Переход по `/tasks` из сайдбара менеджера открывает страницу работника (Preview Worker, таймер, «Отметить готовым», нижний таббар Часы/Журнал/Задачи). Менеджерского интерфейса для Tasks вообще нет доступного.

**Ожидалось:** менеджерская страница «Assign Task» (левая форма) + «All Tasks» список (правая колонка) — как в старом HTML.

**Где починить:** либо в сайдбаре поменять ссылку на `/manager/tasks` (если такая страница есть), либо создать менеджерский `/tasks/page.tsx` и разнести маршруты.

#### REG-3: Worker таббар — дубль «Часы»
В нижнем таб-баре работника две вкладки подписаны «ЧАСЫ» (левая и крайняя правая). Одна из них должна быть другим разделом (например «Профиль» или «Смены»).

**Где починить:** `src/components/worker/WorkerShell.tsx` или аналогичный компонент — проверить `<BottomTabs />` / навигацию, у одной из вкладок неверная метка i18n.

### 🟡 Мелочи, не критично — в OLD_APP_FINDINGS.md уже упомянуто
- «Копировать» у проекта — вероятно копирует только адрес в буфер, а не клонирует проект целиком (пункт 7 OLD_APP_FINDINGS)
- Team ставка только $/hr — не видно модели оплаты (Hourly / Fixed / Per-Project, пункт 2 OLD_APP_FINDINGS)
- Колонка ВИДЕО у Team — рабочая (пустые кружки), но сама фича видео-чекаута ещё не привязана (пункт 1 OLD_APP_FINDINGS)

### 📋 Приоритет после Волны 2

1. **Исправить 3 регрессии (REG-1, REG-2, REG-3)** — один короткий промпт Claude Code, минут на 10-15
2. **Применить мини-миграции** (grace_started_at + app_settings) через Supabase SQL Editor — я сам через Chrome
3. **Настроить webhook** detect-store-visit в Supabase Dashboard — ручная 1 минута
4. Перейти к OLD_APP_FINDINGS.md


---

## ✅ Обновление: мерж в main 19.04.2026

Все 4 ветки смёржены в main через `--no-ff`:
- wave1/safe-fixes
- wave1.5/ui-polish
- wave2/geofence-function
- wave2.5/regression-fixes

**Текущая main содержит:**
- Всю схему БД (миграции 00003, 00004, 00005 применены)
- Edge function detect-store-visit (код написан, НЕ задеплоен)
- Все UI-правки 4 волн
- tsc чистый, lint baseline

**Файлы-артефакты в корне:**
- `AUDIT_REPORT.md` — обновлён по всем 4 волнам
- `PROGRESS_LOG.md` — этот файл
- `OLD_APP_FINDINGS.md` — 20 фич из старого HTML
- `IMPLEMENTATION_PLAN.md` — план Волн 3-9
- `GPS_CONSENT_FORM.md` — двуязычная форма согласия для печати

## 📋 Точка входа для следующего чата

**Готово к:**
1. Деплой edge function: `supabase functions deploy detect-store-visit` (ручная команда)
2. Настройка webhook в Supabase Dashboard на worker_live_locations INSERT (ручной шаг в UI)
3. **Волна 3** — Worker essentials (видеочекаут + Journal + Browse + Cancel). Промпт готов в `IMPLEMENTATION_PLAN.md`. Создаёт миграцию 00006_worker_require_video.sql (не применяет — это моя работа через Supabase SQL Editor в Chrome).

**Рекомендованный порядок волн:** 3 → 5 → 6 → 7 → 8 → 4 → 9
Pay models (Волна 4) идут предпоследними — они самые рискованные (трогают payroll).
