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
- 00001 foundation · 00002 RLS · 00003 schema gap · 00004 geofence grace · 00005 app_settings · 00006 require_video · 00008 project gps_radius · **00009 message priority + notif_mode** ✅ 19.04.2026

### Код и UI (в main)

| Волна | Что сделано | Коммитов |
|-------|-------------|----------|
| **1** (safe-fixes) | 13 безопасных авто-фиксов | 13 |
| **1.5** (ui-polish) | 4 пост-деплой фикса | 4 |
| **2** (geofence-function) | Edge function + /admin/settings + закрытие visits + events | 8 |
| **2.5** (regression-fixes) | Менеджерский /tasks, фикс дубля «Часы» | 3 |
| **3** (worker-essentials) | Before You Leave, Journal, browse projects, Cancel | 4 |
| **5** (hours-admin) | show-to-worker, Reset, Bulk Payroll, DayDetailModal | 4 |
| **6** (project-enrichments) | Per-project GPS radius, Copy Project, Use my location | 5 |
| **3.5** (prod-readiness) | proxy.ts auth gate, vitest 34 тестов, GitHub CI, полный README | 4 |
| **7** (messaging) | 4 priority radio, inbox tint/sort, Прочту позже, silent mode | 5 |

**Всё смёржено в main через `--no-ff`.** tsc чистый, lint baseline, 34 теста проходят, CI работает.

### Инфраструктура
- Edge function `detect-store-visit` — задеплоена через Web UI
- Webhook на `worker_live_locations` INSERT — работает (тест вернул 200)
- GitHub Actions CI — tsc+lint+vitest на push/PR в main

## ⏸️ В процессе / ожидает

- **Волна X1 (User Capabilities)** — security-модель, гибкие права per-user. Промпт коту передан. ~60 мин. Миграция 00010.

## 📋 Ручные шаги впереди

1. **Consent-форма** — ⬜ TODO до первого боевого чекина. `GPS_CONSENT_FORM.md` готов
2. **Выключить AUTH_BYPASS** — когда начнёшь реальный запуск

## 📋 Дальше по плану

**Порядок (решено 19.04.2026):** 7 ✅ → **X1 (сейчас)** → X2 (photo privacy) → X3 (анонимный инцидент-трекер) → X5 (карта + поставщики) → 4 (pay models) → X4 (клиенты) → 9 (real-device)

### Волна X1 — User Capabilities (описание)
- Таблица `user_capabilities` — галочки per-user поверх ролей
- UI `/admin/users/[id]/permissions` с toggle-переключателями
- RLS helper `has_capability(cap text) returns bool`
- Первые 4 capability: `upload_receipts`, `view_all_projects_map`, `view_supply_stores`, `flag_media`
- **Важно:** X1 не меняет существующие RLS. Только **добавляет** инфраструктуру. Следующие волны X2/X3 используют `has_capability()` в своих политиках.
- Миграция 00010

Детали всех Волн — в `IMPLEMENTATION_PLAN.md`.

## 🗂️ Ключевые файлы

- `HANDOFF.md` и `ABOUT_ANDREW.md` — обязательно читать в новой сессии
- `PROGRESS_LOG.md` · `IMPLEMENTATION_PLAN.md` · `AUDIT_REPORT.md` · `OLD_APP_FINDINGS.md`
- `docs/permissions.md` — матрица RBAC (6 ролей × 30 действий)
- `GPS_CONSENT_FORM.md` — для печати работникам
- `README.md` — setup и ссылки на runbook
- `supabase/functions/detect-store-visit/index.ts` — ✅ задеплоена
- `tests/lib/` — vitest кейсы (34 штуки)
- `src/proxy.ts` — Next 16 Proxy (бывший middleware)
- `.github/workflows/ci.yml` — CI pipeline
