# Construction Clock — Хронология работы

## Параметры проекта

- **Путь:** `C:\Users\Nwbui\Documents\Max start bad\check-time\check-time`
- **Активный Supabase:** `vlrajjwbaxikbwvqdpft.supabase.co` ⚠️ URL `khmcdtrzqfqabdpbcjkj` устарел
- **Dev server:** `npm run dev` → `localhost:3000`
- **Tests:** `npm test` (vitest, 34 кейса)
- **AUTH_BYPASS_ENABLED=true** — демо-режим (сейчас с реальными seed-данными в БД)
- **Seed owner:** `00000000-0000-0000-0000-000000000001` (Andrew, owner@example.com, password `ownerdemo!` — СМЕНИТЬ перед шарингом)

## ⚠️ 19.04.2026 — Wash & Reset

БД содержала смесь legacy (workers, events, managers, clients, daily_reports) и новых таблиц. `AUTH_BYPASS` скрывал проблему через preview-data. Данные были тестовые (12 строк), подтверждено Андреем. Выполнен полный сброс и переустановка всех миграций.

## ✅ Применённые миграции БД

```
00099_wash_and_reset        ← drop всех app-таблиц (idempotent)
00001_foundation            ← organizations, profiles, projects, time_events, media (16 col), tasks, payroll + triggers
00002_rls_policies          ← RLS на всех таблицах + is_owner/is_manager/get_user_org_id/get_user_role
00003_schema_gap            ← messages, supply_stores, store_visits, worker_live_locations, worker_location_consents, audit_log, pay_periods, pay_period_items + 'owner' в enum
00004_geofence_grace        ← store_visits.grace_started_at
00005_app_settings          ← singleton + RLS owner-only
00006_worker_require_video  ← profiles.require_video (идемпотентно)
00008_project_gps_radius    ← projects.gps_radius_m check 25..300 default 75
00009_message_priority      ← messages.priority enum, profiles.notif_mode
00010_user_capabilities     ← user_capabilities table + has_capability() function
00011_media_project_privacy ← media SELECT RLS split by role (X2 migration)
seed_dev.sql                ← 1 org + Andrew owner + Test Site project + assignment
```

## ✅ Код в main (все волны смёржены через --no-ff)

| Волна | Что | Commits |
|-------|-----|---------|
| 1 safe-fixes | 13 авто-фиксов | 13 |
| 1.5 ui-polish | dedupe EventFeed, payroll empty-state, Team table | 4 |
| 2 geofence-function | Edge function + /admin/settings + webhooks | 8 |
| 2.5 regression-fixes | Manager /tasks, «Часы» фикс | 3 |
| 3 worker-essentials | Before You Leave, Journal, browse projects, Cancel | 4 |
| 5 hours-admin | show-to-worker, Reset, Bulk Payroll, DayDetailModal | 4 |
| 6 project-enrichments | GPS radius, Copy Project, Use my location | 5 |
| 3.5 prod-readiness | proxy.ts, vitest 34 тестов, CI, README | 4 |
| 7 messaging | 4 priorities, inbox tint, Прочту позже, silent mode | 5 |
| X1 user-capabilities | per-user permission overrides, /admin/users/[id]/permissions | 3 |
| X2 photo-privacy | media SELECT RLS split by role | 4 |
| **WR schema-reconciliation** | **seed_dev.sql + PREVIEW_OWNER_ID** | **2** |

**Текущий главный:** commit `d3b62da` (merge waveWR)

## ⏸ В процессе

- **Волна X3 (incident tracker)** — промпт коту отдан 19.04.2026. Анонимный инцидент-трекер 🚩, миграция 00012.

## 📋 Впереди по плану

**Порядок:** X3 (сейчас) → X5 (worker map + stores) → Волна 8 (reliability) → Волна 4 (pay models — high risk) → X4 (клиенты) → Волна 9 (real-device testing)

### Волна X3 — Anonymous incident tracker (детали)
- Таблица `media_flags` + view `media_flags_public` (скрывает flagged_by/reviewed_by)
- UI 🚩 «Отметить для проверки» в галерее
- Все на проекте видят флаг + note, автор скрыт
- Owner/manager видят автора + могут нажать «✅ Проверено»
- Миграция 00012, ~45 мин

## Инфраструктура ✅

- Edge function `detect-store-visit` — задеплоена через Web UI
- Webhook на `worker_live_locations` INSERT — работает
- GitHub Actions CI — tsc+lint+vitest

## Ручные шаги впереди

1. **GPS_CONSENT_FORM.md** — распечатать и подписать с работниками до первого боевого чекина
2. **Выключить AUTH_BYPASS** — при реальном запуске
3. **Сменить пароль `ownerdemo!`** в seed — перед шарингом БД

## Ключевые файлы

- `HANDOFF.md` и `ABOUT_ANDREW.md` — читать первыми в новой сессии
- `PROGRESS_LOG.md` (этот файл)
- `IMPLEMENTATION_PLAN.md` — детальные описания всех волн X1-X5
- `AUDIT_REPORT.md`, `OLD_APP_FINDINGS.md`
- `docs/permissions.md` — матрица RBAC
- `supabase/migrations/00099_wash_and_reset.sql` — если придётся сбрасывать ещё раз
- `supabase/seed_dev.sql` — минимальный seed после сброса
- `src/lib/auth-bypass.ts` — `AUTH_BYPASS_ENABLED`, `PREVIEW_OWNER_ID`
- `src/proxy.ts` — Next 16 Proxy (auth gate, session refresh)
- `.github/workflows/ci.yml` — CI pipeline
- `tests/lib/` — vitest кейсы (34 штуки)
