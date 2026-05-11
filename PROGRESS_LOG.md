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
- `PLAN_PARTIAL_COMPLETION.md` — дизайн «Частичное выполнение + история» (план)
- `PLAN_TASK_ARCHIVE.md` — дизайн «Архив задач» (план)
- `AUDIT_REPORT.md`, `OLD_APP_FINDINGS.md`
- `docs/permissions.md` — матрица RBAC
- `supabase/migrations/00099_wash_and_reset.sql` — если придётся сбрасывать ещё раз
- `supabase/seed_dev.sql` — минимальный seed после сброса
- `src/lib/auth-bypass.ts` — `AUTH_BYPASS_ENABLED`, `PREVIEW_OWNER_ID`
- `src/proxy.ts` — Next 16 Proxy (auth gate, session refresh)
- `.github/workflows/ci.yml` — CI pipeline
- `tests/lib/` — vitest кейсы (354 штуки на 9 мая 2026)

---

## ✅ 9 мая 2026 — Mark Done bug, instant-flip, voice dictation, прод-деплой

Длинная сессия восстановления и доводки фичи завершения задач. Итог — рабочий продакшен на `check-time-five.vercel.app`.

### Найденный баг (root cause)

В `WorkerShell.updateTaskStatus` стоял guard:
```ts
if (nextStatus === "done" && !options?.submittedFromCompletionModal) {
  throw new Error(t("tasks.completionModalRequired"));
}
```
Но флаг `submittedFromCompletionModal: true` **не устанавливал ни один caller** — ни модалка, ни обёртка в TasksPage/WorkerProjectView. То есть **100% попыток нажать «Отметить готовым» заканчивались исключением до записи в БД.** На UI это выглядело как «задача выполнена» (оптимистичный flip в `WorkerProjectView.markLocalTask`), но F5 возвращал её обратно в активные — потому что в БД `status` так и оставался `in_progress`.

Диагностика подтверждена прямым SQL-запросом по таску «888888»: `status=in_progress`, `completed_at=null`, `metadata={}` после нескольких попыток «закрыть».

### Фикс — коммит `c2af391`

`fix(worker): mark-done modal now actually persists to DB`
- В `TasksPage.tsx` и `WorkerProjectView.tsx` обёртки `onDone` теперь добавляют `submittedFromCompletionModal: true` в options к `updateTaskStatus`.
- `updateTaskStatus` теперь возвращает `Promise<boolean>` (вместо `Promise<void>`), чтобы caller знал успех.
- В `WorkerProjectView.tsx` `markLocalTask("done")` сдвинут **после** успешного await — на ошибке UI не врёт.
- Guard оставлен на месте — он защищает от случайных done-мутаций мимо модалки.

### Добавление instant-flip на /my-tasks — коммит `90adb9a`

`feat(worker): instant flip Mark-Done card to «Завершено» on /my-tasks`
- В `TasksPage.tsx` появился третий слой override-Map: `locallyCompletedTaskIds: Set<string>` рядом с существующими `claimedTaskAssignees` / `claimedTaskMetadata`.
- После успешного `updateTaskStatus` id попадает в Set — `taskList` useMemo подменяет `status="done"` на этом id, карточка сразу едет в раздел «Завершено» без F5. На неудаче Set не пополняется и UI остаётся честным.

### Голосовой ввод в модалке завершения

В `WorkerTaskDetailModal.tsx` встроен локальный hook `useCompletionDictation` поверх Web Speech API (`window.SpeechRecognition`/`webkitSpeechRecognition`). Конфигурация: `lang="ru-RU"`, `continuous=true`, `interimResults=true`. Кнопка микрофона смонтирована в правый верхний угол textarea «Комментарий о выполнении». Финальные фразы дописываются в state с пробелом-разделителем; интерим-фразы показываются курсивом ниже, в state не пишутся. Если API недоступно — кнопка не рендерится. Если разрешение отклонено — инлайн-сообщение «Разрешите доступ к микрофону». Этот код уже был на диске когда я начинал сессию (chat-side hotfix), сегодня скоммичен в составе восстановления.

### Восстановление 80+ незакоммиченных файлов

На старте сессии в working tree висели сорок с лишним модифицированных файлов и тридцать новых — chat-side hotfix без коммитов. Разложено на ветке `wip/uncommitted-recovery`:

```
8877b94 chore(scripts): Vercel REST helpers for env push and SSO protection
90adb9a feat(worker): instant flip Mark-Done card to «Завершено» on /my-tasks
c2af391 fix(worker): mark-done modal now actually persists to DB        ← прод
cd29f5c wip: misc uncommitted changes (needs review)
73578df fix(media): RLS migration for all_active project access + worker receipt visibility
e2e5fd0 fix(payroll): RLS migration without recursion + calculator updates
d0caf76 feat(media): in-app viewer modal + gallery drawer + playback selection
3ddd68b feat(worker): completion modal + Russian voice dictation for Mark Done
267636a chore: gitignore certificates and .vercel artifacts
9178945 Fix checkout video linking under RLS                              ← последний коммит main
```

Мусор (логи, .vercel.zip, скриншоты, .claude/) оставлен незакоммиченным намеренно.

### Vercel — сетап, env, деплой

- Установил `vercel CLI 53.2.0` глобально.
- Залил 5 из 7 нужных env в Preview через REST (`scripts/push-preview-env.mjs`): Supabase URL/anon/service-role, Google Maps key, AUTH_BYPASS=false. ANTHROPIC_API_KEY и OPENAI_API_KEY в `.env.local` пустые — не залиты, но билд этого не требует (AI-роуты работают в рантайме).
- Временно отключил Vercel SSO protection на preview, чтобы можно было открыть URL без логина (`scripts/toggle-preview-protection.mjs`). После прод-деплоя восстановил `ssoProtection: { deploymentType: "all_except_custom_domains" }` — preview URLs снова за стеной, прод-алиас публичный.

### Производственный деплой

- `vercel --prod --yes` собрал и задеплоил состояние working tree (включая uncommitted TasksPage tweak — тот же код, что прошёл preview-тест на `mk1wuk2iu`).
- Deployment id: `dpl_3Rhd6rfnP7AAEVBkh991xGNfwLjk`.
- Production URL: `https://check-time-five.vercel.app` (плюс два aliases).
- Build status: READY, target=production.
- Андрей вручную проверил: workflow «Mark Done» работает на личных задачах, на общих задачах проекта; модалка открывается; комментарий опциональный; owner видит «Назначено / Выполнено / Когда / комментарий» как в `/tasks`, так и в карточке проекта.

### Что НЕ зафиксировано в main

Ветка `wip/uncommitted-recovery` сейчас имеет 7 коммитов поверх главной (`9178945` — последний коммит main). До мержа в main стоит:
1. Сделать ревью каждого из них в отдельности (особенно `cd29f5c wip: misc uncommitted changes (needs review)` — там 30+ файлов, помеченных «нужно разобрать»).
2. Дождаться следующей сессии — Андрей мержит сам.

### Бэклог — следующая сессия

Приоритеты обсуждены ночью 9 мая, фиксированы в `HANDOFF.md`. Два главных фронта:
1. **Частичное выполнение задач** — детальный дизайн в `PLAN_PARTIAL_COMPLETION.md`.
2. **Архив задач** — детальный дизайн в `PLAN_TASK_ARCHIVE.md`.

Плюс UX-полировка: приватность чеков работника, компактные блоки медиа, сворачиваемая «Завершено», переорганизация worker project page, фикс мерцания видео при открытии медиа.
