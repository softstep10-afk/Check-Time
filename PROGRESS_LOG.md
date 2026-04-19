# Construction Clock — Хронология работы

## Параметры проекта

- **Путь:** `C:\Users\Nwbui\Documents\Max start bad\check-time\check-time`
- **Активный Supabase:** `vlrajjwbaxikbwvqdpft.supabase.co` ⚠️ *URL `khmcdtrzqfqabdpbcjkj` устарел — игнорировать*
- **Dev server:** `npm run dev` → `localhost:3000`
- **Claude Code:** `claude --dangerously-skip-permissions`
- **AUTH_BYPASS_ENABLED=true** — демо-режим с Owner по умолчанию

## ✅ Сделано и смёржено в main

### Фундамент БД
- **Миграция 00003** — 8 таблиц (messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items) + роль `owner` + `start_date`/`end_date` на projects
- **Миграция 00004** — `store_visits.grace_started_at` (60-секундный буфер для геозон)
- **Миграция 00005** — `app_settings` singleton со значением по умолчанию `{"geofence_radius_meters": 75}` + 2 RLS-полиси
- **Миграция 00006** — `profiles.require_video` (для Before You Leave); идемпотентна

### Код и UI (в main, git history → `.git/logs/HEAD`)

| Волна | Что сделано | Коммитов |
|-------|-------------|----------|
| **1** (safe-fixes) | 13 безопасных авто-фиксов из AUDIT_REPORT.md: dead code, hydration, Projects traffic-lights, Team VIDEO/TOTAL/Actions, receipt rollup, i18n Loading, annual Store Activity | 13 |
| **1.5** (ui-polish) | 4 пост-деплой фикса: dedupe EventFeed, localized DateField, payroll empty-state с пресетами, Team cards→table | 4 |
| **2** (geofence-function) | Edge function detect-store-visit, /admin/settings со слайдером радиуса, closeOpenStoreVisits на clock-out, store_visit events в EventFeed, worker profile «визиты за неделю», webhook doc в README | 8 |
| **2.5** (regression-fixes) | Менеджерский /tasks (worker→/my-tasks), фикс дубля «Часы» в worker bottom-nav | 3 |
| **3** (worker-essentials) | Before You Leave video gate, Journal с группировкой по дням, browse other projects в смене, Cancel stay checked in | 4 |

**Всё смёржено в main через `--no-ff`.** tsc чистый, lint baseline 15 problems.

## 🔓 Ручные шаги, которые ещё впереди

### 1. Edge function deploy (1 команда)
```
supabase functions deploy detect-store-visit
```
После этого нужен Supabase CLI (у Андрея уже установлен? проверить через `supabase --version`).

### 2. Database webhook в Supabase Dashboard (1 минута в UI)
Dashboard → Database → Webhooks → Create:
- Source: `worker_live_locations`
- Event: INSERT
- HTTP: POST на URL задеплоенной edge function
- Body: record payload

Без этого edge function не срабатывает на новые GPS-точки — визиты в магазины не детектируются.

### 3. Consent-форма подписать с работниками (до первого боевого чекина)
Файл `GPS_CONSENT_FORM.md` готов на EN+RU. Распечатать, подписать, подшить. Версия 1.
Тексты формы должны совпадать с текстом модалки в `src/components/worker/GpsConsentModal.tsx`.

## 📋 Дальше по плану

**Рекомендованный порядок Волн:** 5 → 6 → 7 → 8 → 4 → 9 (Волна 4 pay-models предпоследняя — самая рискованная).

Детали и готовые промпты — в `IMPLEMENTATION_PLAN.md`.

### Следующая — Волна 5 (Hours admin)
- Adjust Hours: чекбокс «Показать работнику»
- Reset Hours to Zero: отдельная кнопка с подтверждением
- Bulk Payroll: чекбоксы + «Выбрать всех» + «Обработать выбранных»
- Day Detail drill-down: клик на день → попап с breakdown
- **Миграций нет.** Низкий риск.

## 🗂️ Ключевые файлы-артефакты

- `AUDIT_REPORT.md` — полный аудит, обновлён по всем Волнам 1-3
- `PROGRESS_LOG.md` — этот файл
- `IMPLEMENTATION_PLAN.md` — план Волн 5-9 с промптами для Claude Code
- `OLD_APP_FINDINGS.md` — 20 фич из старого HTML, сырьё для Волн 4-8
- `GPS_CONSENT_FORM.md` — двуязычный шаблон согласия
- `HANDOFF.md` — накопленное tribal knowledge (читать ОБЯЗАТЕЛЬНО при старте новой сессии)
- `supabase/migrations/00003_schema_gap.sql` — применена
- `supabase/migrations/00004_geofence_grace.sql` — применена
- `supabase/migrations/00005_app_settings.sql` — применена
- `supabase/migrations/00006_worker_require_video.sql` — применена
- `supabase/functions/detect-store-visit/index.ts` — код edge function, не задеплоен
- `supabase/README.md` — инструкции по deploy + webhook
