# Construction Clock — Хронология работы

## Параметры проекта

- **Путь:** `C:\Users\Nwbui\Documents\Max start bad\check-time\check-time`
- **Активный Supabase:** `vlrajjwbaxikbwvqdpft.supabase.co` ⚠️ *URL `khmcdtrzqfqabdpbcjkj` устарел — игнорировать*
- **Dev server:** `npm run dev` → `localhost:3000`
- **Claude Code:** `claude --dangerously-skip-permissions`
- **AUTH_BYPASS_ENABLED=true** — демо-режим с Owner по умолчанию

## ✅ Сделано и смёржено в main

### Фундамент БД (все миграции применены)
- **00001** — foundation (профили, проекты, часы, чеки, фото, задачи)
- **00002** — RLS политики, хелперы `is_owner()`/`is_manager()`
- **00003** — 8 таблиц (messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items) + роль `owner`
- **00004** — `store_visits.grace_started_at` (60-сек буфер для геозон)
- **00005** — `app_settings` singleton с `{"geofence_radius_meters": 75}`
- **00006** — `profiles.require_video` (идемпотентна)
- **00007** — 🔒 зарезервирован под Волну 4 (pay models)
- **00008** — `projects.gps_radius_m` int 25..300, default 75 ✅ ПРИМЕНЕНА 19.04.2026

### Код и UI (в main)

| Волна | Что сделано | Коммитов |
|-------|-------------|----------|
| **1** (safe-fixes) | 13 безопасных авто-фиксов из AUDIT_REPORT.md | 13 |
| **1.5** (ui-polish) | 4 пост-деплой фикса: dedupe EventFeed, localized DateField, payroll empty-state, Team cards→table | 4 |
| **2** (geofence-function) | Edge function detect-store-visit, /admin/settings со слайдером радиуса, closeOpenStoreVisits на clock-out, store_visit events в EventFeed, worker profile «визиты за неделю» | 8 |
| **2.5** (regression-fixes) | Менеджерский /tasks, фикс дубля «Часы» в worker bottom-nav | 3 |
| **3** (worker-essentials) | Before You Leave video gate, Journal по дням, browse other projects, Cancel stay checked in | 4 |
| **5** (hours-admin) | Adjust Hours show-to-worker, Reset Hours to Zero, Bulk Payroll, DayDetailModal | 4 |
| **6** (project-enrichments) | Per-project GPS radius slider, Copy Project, Use my location, check-in reads gps_radius_m with fallbacks | 5 |

**Всё смёржено в main через `--no-ff`.** tsc чистый, lint baseline 15 problems.

### Edge Function + Webhook — ✅ ПРОДАКШН
- **Function URL:** `https://vlrajjwbaxikbwvqdpft.supabase.co/functions/v1/detect-store-visit`
- **Deployed:** 19.04.2026 через Supabase Dashboard Web UI (CLI у Андрея не установлен)
- **Webhook:** `detect_store_visit_on_location` на `worker_live_locations` INSERT → Supabase Edge Function `detect-store-visit` (POST, JWT авто)
- **Test:** выполнен через Dashboard → Functions → Test с payload (0,0) → ответ 200 `{"ok":true,"action":"noop","detail":"outside-all"}`

## ⏸️ В процессе

### Волна 3.5 — Production readiness
Ветка `wave3.5/prod-readiness`. Кот пишет:
- `src/middleware.ts` — Supabase SSR session refresh
- `vitest` + юнит-тесты для `manager-utils.ts` payroll и `geofence.ts` haversine
- `.github/workflows/ci.yml` — tsc + lint + vitest на push/PR
- `README.md` — реальная документация вместо дефолтной create-next-app

**Без миграций, без новых фич. Hardening only.** ~40 мин.

## 📋 Ручные шаги впереди

### 1. Consent-форма — ⬜ TODO (ДО первого боевого чекина)
Файл `GPS_CONSENT_FORM.md` готов на EN+RU. Распечатать, подписать, подшить.

### 2. RBAC уточнение — под вопросом
6-уровневая иерархия ролей (Owner/Admin/Manager/Supervisor/Driver/Worker) + матрица 30+ действий уже спроектированы в `docs/permissions.md`. RLS использует `is_owner()`/`is_manager()`. Но UI для смены ролей и все RLS по матрице — не полностью реализованы. Обсудить с Андреем какой сценарий (A/B/C) нужен — см. чат.

## 📋 Дальше по плану

**Рекомендованный порядок:** ~~5~~ → ~~6~~ → **3.5** (сейчас) → 7 → 8 → 4 → 9.

### Волна 7 — Messaging polish
- 4 цвета сообщений (urgent/info/good/task), priority enum
- «Прочту позже» кнопка в инбоксе
- notif_mode (sound/silent) в профиле работника
- Миграция 00009

### Волна 8 — Reliability
- Offline upload queue
- STORAGE_LIMITS_MB клиентская валидация
- Пресеты диапазонов дат
- Media type filter (Photos/Videos/PDFs)
- Voice input audit
- Без миграций

### Волна 4 — Pay models 🔥 РИСКОВАЯ
- 3 модели оплаты: hourly / fixed_amount / fixed_per_project
- Миграция 00007 (зарезервирован номер)
- Трогает payroll — поэтому предпоследняя, после hardening и тестов

### Волна 9 — Real-device testing + consent rollout

## 🗂️ Ключевые файлы-артефакты

- `AUDIT_REPORT.md` — полный аудит, обновлён по всем Волнам 1-3
- `PROGRESS_LOG.md` — этот файл
- `IMPLEMENTATION_PLAN.md` — план Волн 5-9 с промптами для Claude Code
- `OLD_APP_FINDINGS.md` — 20 фич из старого HTML, сырьё для Волн 4-8
- `GPS_CONSENT_FORM.md` — двуязычный шаблон согласия
- `HANDOFF.md` — накопленное tribal knowledge (читать ОБЯЗАТЕЛЬНО при старте новой сессии)
- `ABOUT_ANDREW.md` — про стиль Андрея (читать после HANDOFF.md)
- `docs/permissions.md` — RBAC матрица 30+ действий × 6 ролей
- `supabase/migrations/00001-00006, 00008` — все применены
- `supabase/functions/detect-store-visit/index.ts` — ✅ задеплоена через Web UI
