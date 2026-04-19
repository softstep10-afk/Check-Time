# Construction Clock — Хронология работы

## Параметры проекта

- **Путь:** `C:\Users\Nwbui\Documents\Max start bad\check-time\check-time`
- **Активный Supabase:** `vlrajjwbaxikbwvqdpft.supabase.co` ⚠️ *URL `khmcdtrzqfqabdpbcjkj` устарел — игнорировать*
- **Dev server:** `npm run dev` → `localhost:3000`
- **Tests:** `npm test` (vitest, 34 кейса)
- **Claude Code:** `claude --dangerously-skip-permissions`
- **AUTH_BYPASS_ENABLED=true** — демо-режим с Owner по умолчанию

## ✅ Сделано и смёржено в main

### Фундамент БД (все применены)
- **00001** foundation · **00002** RLS · **00003** schema gap · **00004** geofence grace · **00005** app_settings · **00006** require_video · **00008** project gps_radius · (00007 зарезервирован под Волну 4 pay models)

### Код и UI (в main)

| Волна | Что сделано | Коммитов |
|-------|-------------|----------|
| **1** (safe-fixes) | 13 безопасных авто-фиксов | 13 |
| **1.5** (ui-polish) | 4 пост-деплой фикса | 4 |
| **2** (geofence-function) | Edge function detect-store-visit, /admin/settings, closeOpenStoreVisits, store_visit events, worker profile визиты | 8 |
| **2.5** (regression-fixes) | Менеджерский /tasks, фикс дубля «Часы» | 3 |
| **3** (worker-essentials) | Before You Leave video, Journal по дням, browse other projects, Cancel | 4 |
| **5** (hours-admin) | Adjust show-to-worker, Reset Hours, Bulk Payroll, DayDetailModal | 4 |
| **6** (project-enrichments) | Per-project GPS radius, Copy Project, Use my location | 5 |
| **3.5** (prod-readiness) | `src/proxy.ts` auth gate (Next 16 rename), vitest 34 тестов (payroll+geofence), GitHub Actions CI, полноценный README | 4 |

**Всё смёржено в main через `--no-ff`.** tsc чистый, lint baseline 15 problems, 34 теста проходят.

### Инфраструктура (✅ ПРОДАКШН)
- **Edge function** `detect-store-visit` задеплоена через Dashboard Web UI (CLI не установлен)
- **Webhook** `detect_store_visit_on_location` на `worker_live_locations` INSERT → функция (JWT auto)
- **CI** — каждый push/PR в main: tsc, eslint, vitest

## 📋 Ручные шаги впереди

1. **Consent-форма** — ⬜ TODO до первого боевого чекина. `GPS_CONSENT_FORM.md` готов.
2. **Выключить AUTH_BYPASS** — когда начнёшь реальный запуск. Сейчас все автоматически Owner.

## 📋 Дальше по плану

**Порядок (решено с Андреем 19.04.2026):** **7 (сейчас)** → X1 (user_capabilities) → X2/X3/X5 (security модель) → 4 (pay models) → X4 (клиенты) → 9 (real-device testing)

### Волна 7 — Messaging polish (сейчас)
- 4 цвета сообщений (urgent/info/good/task), priority enum
- «Прочту позже» кнопка в инбоксе
- notif_mode (sound/silent) в профиле работника
- Миграция 00009

### Волна X1 — User Capabilities (следом)
- Таблица `user_capabilities` — галочки per-user, override ролей
- UI `/admin/users/[id]/permissions`
- RLS helper `has_capability()`
- Миграция 00010

Детали всех волн — в `IMPLEMENTATION_PLAN.md` (в т.ч. обновлённый X3 — анонимный инцидент-трекер).

## 🗂️ Ключевые файлы

- `AUDIT_REPORT.md`, `OLD_APP_FINDINGS.md`, `IMPLEMENTATION_PLAN.md`
- `HANDOFF.md` и `ABOUT_ANDREW.md` — обязательно читать в новой сессии
- `docs/permissions.md` — матрица RBAC
- `GPS_CONSENT_FORM.md` — для печати работникам
- `README.md` — setup и ссылки на все runbook
- `supabase/functions/detect-store-visit/index.ts` — ✅ задеплоена
- `tests/lib/` — vitest кейсы
- `src/proxy.ts` — Next 16 Proxy (бывший middleware)
- `.github/workflows/ci.yml` — CI pipeline
