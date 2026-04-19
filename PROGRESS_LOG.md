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
