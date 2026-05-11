# План: Архив задач

**Статус:** дизайн-документ. Кода ещё нет. Связан с `PLAN_PARTIAL_COMPLETION.md` — желательно решать вместе или сразу после.

**Дата:** 9 мая 2026, ночная сессия.

---

## 🎯 Что мы делаем и зачем

Сейчас в системе есть `tasks.deleted_at` (soft-delete) и страница `/trash` для восстановления. Это технический «корзинный» механизм, и он работает, но плохо подходит для рабочего сценария Андрея:

- задача завершена → лежит в «Завершено» вечно;
- завершённых тысячи через 6 месяцев → визуально шумно;
- иногда нужно «убрать с глаз», но **не удалить** — а сохранить полную историю для аудита.

**Цель:** дать Owner отдельное действие «отправить в архив», страницу архива с фильтрами и возможностью восстановления. Это **не удаление**. История сохраняется полностью — статус, комментарии, медиа, история партиал-отчётов (если её добавим из `PLAN_PARTIAL_COMPLETION.md`), кто/когда/почему архивировал.

---

## ✅ Что решено пользователем (поведение)

1. **Только Owner архивирует** (не manager, не supervisor, не worker). У Owner появляется кнопка «Архивировать» на завершённой задаче.

2. **Страница архива** — отдельный route, например `/archive` (только Owner / Admin). Содержит:
   - Фильтр по диапазону дат (календарь from–to).
   - Фильтр по проекту (multi-select из списка проектов).
   - Фильтр по работнику (multi-select из активных + удалённых из команды).
   - Поиск по тексту заголовка / комментария.
   - Пагинация по 50 / 100.

3. **Что хранится в архиве** (полная картина):
   - `tasks.*` все колонки (включая `metadata`)
   - `tasks.completion_history` (если внедрим Variant A из `PLAN_PARTIAL_COMPLETION.md`)
   - связанные `task_reports` (если внедрим Variant B)
   - связанные media (через `attachment_media_ids` + `completion_media_ids`)
   - `archived_by` (uuid), `archived_at` (timestamptz), опциональный `archive_reason` (text)

4. **Восстановление** — Owner-кнопка «Восстановить из архива» на странице архива. Задача возвращается в обычный список с тем статусом, который у неё был в момент архивации (если final — в «Завершено», если в работе — в активные).

---

## 🗄 Варианты схемы — два альтернативных пути

### Вариант A: колонки `archived_at` + `archived_by` на `tasks`

```sql
alter table public.tasks
  add column if not exists archived_at  timestamptz,
  add column if not exists archived_by  uuid references public.profiles(id) on delete set null,
  add column if not exists archive_reason text;

create index tasks_archived_at_idx
  on public.tasks (archived_at)
  where archived_at is not null;
```

Все запросы существующего worker/manager UI добавляют `where archived_at is null`. На странице `/archive` запрос `where archived_at is not null`.

**Плюсы:**
- Минимальная миграция — три колонки.
- Никаких копирований — задача в одном месте.
- Восстановление = `update set archived_at = null`.
- История сохраняется автоматически (всё уже в `metadata` или `task_reports`).
- Совместимо с обоими вариантами схемы из `PLAN_PARTIAL_COMPLETION.md`.

**Минусы:**
- Все 20+ запросов в `worker-data.ts` / `manager-data.ts` / etc. нужно обновить — `where deleted_at is null` уже есть, добавить `and archived_at is null`. Легко забыть один → приходит баг.
- Длинная таблица `tasks` с архивами годами растёт. Индексы и партиционирование станут нужны.
- Миграция данных не нужна, но обходить старые запросы нужно осторожно.

### Вариант B: отдельная таблица `tasks_archive`

```sql
create table public.tasks_archive (
  -- зеркало public.tasks с теми же типами и constraint'ами
  id              uuid primary key,
  org_id          uuid not null references public.organizations(id),
  project_id      uuid references public.projects(id) on delete set null,
  title           text not null,
  description     text,
  priority        public.task_priority not null,
  status          public.task_status not null,
  due_date        date,
  assigned_to     uuid,
  assigned_by     uuid,
  completed_at    timestamptz,
  completed_by    uuid,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null,
  updated_at      timestamptz not null,
  deleted_at      timestamptz,
  -- архивные поля
  archived_at     timestamptz not null default now(),
  archived_by     uuid references public.profiles(id) on delete set null,
  archive_reason  text,
  -- сохраняем ссылку на оригинал на случай повторной архивации
  original_task_id uuid not null
);

-- если есть task_reports — аналогичная task_reports_archive
```

Архивация = `INSERT INTO tasks_archive` + `DELETE FROM tasks` в одной транзакции (или через Postgres function / trigger). Восстановление — обратное.

**Плюсы:**
- Чистое разделение: «активные данные» vs «исторические». `tasks` остаётся компактной.
- Существующие запросы менять **не нужно** — они и так не видят архивные задачи.
- Удобно для будущего partition'инга по дате архивации.
- Можно к `tasks_archive` применять разные RLS: например, скрывать от worker полностью.

**Минусы:**
- Два таблицы — надо синхронизировать структуру при будущих миграциях `tasks`.
- Восстановление сложнее: копировать обратно, удалять из архива, сохранить целостность FK (если на задачу ссылаются другие записи — например, `task_reports` с FK на `tasks.id`).
- Если ссылки на задачу есть из других таблиц (media через `attachment_media_ids`, future `task_reports`), нужно либо: (1) держать архив отдельно с soft-FK, либо (2) при архивации задачи копировать связанные записи в их собственные `*_archive` таблицы.

### Рекомендация — без выбора

**Если в проекте Андрея ожидается до ~10000 задач за всё время** — `Variant A` достаточен (с индексом на `archived_at`).

**Если планируется массовый ввод (десятки задач в день, тысячи в месяц)** — `Variant B` надёжнее на 2–5 лет вперёд.

User-decision-point.

---

## 🔁 Связь с существующим `/trash` (soft-delete)

В коде уже есть:
- `tasks.deleted_at` колонка (`null` = активна, timestamptz = в trash)
- `/trash` страница (`src/app/(manager)/trash/page.tsx`) — restore + permanent delete
- Все queries в `worker-data.ts` / `manager-data.ts` уже фильтруют `is null`

**Стоит ли объединить trash + archive?** Возможные дизайны:

- **Раздельно (рекомендую):** `deleted_at` = «удалено по ошибке / спам / ненужное» (всё, кроме архива). `archived_at` = «работа сделана, отправлено в долгое хранение». Семантически разные. UI разный: `/trash` — короткий список с restore/delete, `/archive` — поисковый интерфейс с фильтрами.

- **Объединённо:** одна колонка `deleted_at` + флаг `delete_reason: "trash" | "archive"`. Минус — на странице архива придётся фильтровать по причине, и семантика `deleted_at` мутится.

Открытый вопрос — см. ниже.

---

## 📁 Что трогаем

### Миграция

- Variant A: `supabase/migrations/000XX_task_archive_columns.sql`
- Variant B: `supabase/migrations/000XX_tasks_archive_table.sql` + (опц.) `task_reports_archive`

### UI

- **Новый route:** `src/app/(manager)/archive/page.tsx` (Owner / Admin only — проверить через `proxy.ts` и role-guard).
- **Новый компонент:** `src/components/manager/TaskArchivePage.tsx` — список + фильтры + пагинация.
- **Новый shared компонент:** `ArchivedTaskRow` — карточка задачи в архиве (read-only + кнопка «Восстановить»).
- **Кнопка «Архивировать»** в:
  - `src/components/manager/ManagerTasksPage.tsx` (на завершённых задачах)
  - `src/components/manager/ProjectDetailPage.tsx` (внутри секции «Завершено»)

### Логика

- **Новый API route** `src/app/api/manager/archive-task/route.ts`:
  - `POST` — архивировать (тело: `taskId`, опц. `archive_reason`). Проверка роли = owner/admin.
  - `POST /restore` — восстановить.
- **Variant A**: оба маршрута — простые UPDATE через service-role admin client (как `/api/worker/claim-task`).
- **Variant B**: оба маршрута — две операции в транзакции (RPC или две query'и в один POST).

- **`src/lib/manager-data.ts`** — добавить функцию `fetchArchivedTasks(filters)` с пагинацией.

### RLS

- **Variant A**: 
  - Существующая RLS на `tasks` уже регулирует доступ. Нужно только правило для `archived_at`-фильтрации в коде, не в RLS.
  - Альтернативно: добавить RLS-условие «non-owner workers не видят `archived_at IS NOT NULL`» — лишний слой защиты.

- **Variant B**:
  - Новая таблица `tasks_archive` — нужны политики SELECT для owner/admin.
  - Worker / manager не видят архив ни при каких условиях.

### Существующие запросы (Variant A only)

Перечень файлов, где есть `is("deleted_at", null)` — туда же добавить `is("archived_at", null)`:

- `src/lib/worker-data.ts` (4 query)
- `src/lib/manager-data.ts` (3+ query)
- `src/components/worker/WorkerProjectView.tsx` (1)
- `src/components/manager/ManagerTasksPage.tsx` (несколько)
- `src/components/manager/ProjectDetailPage.tsx` (несколько)
- `src/app/api/worker/claim-task/route.ts` (1)
- `src/app/api/worker/project-tasks/route.ts` (1)
- `src/app/(worker)/project/[id]/page.tsx` (1)

**Variant B** этого не требует — таблица `tasks` остаётся чистой, существующие запросы не нужно менять.

### Тесты

- `tests/lib/task-archive.test.ts` — pure-logic тесты для:
  - `isTaskVisibleToWorker` всё ещё true для не-архивных
  - `isTaskVisibleToWorker` false для архивных
  - filter logic для archive page (диапазон дат, проект, работник)
- Если Variant B: интеграционный тест на копирование данных task → tasks_archive (мокнутый Supabase client).

---

## ❓ Открытые вопросы — нужны ответы перед стартом

1. **Variant A или Variant B?** (см. выше). Мой совет: начать с A — он простой и обратимый. Если через год архив раздуется, мигрируем в B (вытянуть `where archived_at is not null` в новую таблицу — простая миграция).

2. **Унифицировать с `/trash` или нет?** Мой совет: разделить (см. секцию выше). `deleted_at` = ошибки, `archived_at` = выполненная работа в холодном хранилище.

3. **Может ли архивироваться задача, которая ещё не завершена?** Сценарий: проект отменён, задачи на нём больше не нужны, но удалять не хочется. **Предполагаю: да, можно архивировать любую задачу (active / done / cancelled)**. Подтверди.

4. **Период автоматической архивации?** Например — все задачи `done` старше 90 дней автоматически уходят в архив. Сейчас — НЕ нужно (Owner делает руками). Но стоит зафиксировать решение.

5. **Permanent delete из архива?** Сейчас в `/trash` есть hard-delete. В архиве — должен ли быть? **Предполагаю: нет.** Архив = иммутабелен. Если действительно нужно стереть (GDPR, ошибка) — Andrew делает SQL вручную.

6. **Реакция на удалённого работника.** Если работник, выполнивший задачу, уволен и удалён из `profiles` — что показывать в архиве вместо его имени? **Предполагаю: «Удалённый сотрудник» + сохранённый snapshot его имени в `metadata.completed_by_recorded_name` на момент завершения.** Этот snapshot нужно начать сохранять прямо сейчас, иначе старые задачи потеряют атрибуцию.

7. **Связь с media.** Если задача архивируется, медиа (фото/видео) остаются в Supabase Storage. **Предполагаю: оставляем как есть** — storage cheap, удалять опасно. Если задача восстанавливается — медиа уже на месте.

8. **Архив виден в /timeline?** Сейчас timeline показывает все события. Архив-action — это событие? Должен ли он попасть в `audit_log`? **Предполагаю: да, `audit_log` запись с типом `task_archived` и `task_restored`** — для compliance.

---

## 📦 Объём работы (грубая прикидка)

- **Variant A**: ~1 волна (~60 мин). Миграция простая, основная работа — добавить `where archived_at is null` в 10–12 мест и сделать `/archive` страницу.
- **Variant B**: ~2 волны. Первая — миграция + копирующая логика. Вторая — UI.

Делать после `PLAN_PARTIAL_COMPLETION.md`, потому что:
- архивация без сохранения истории отчётов = потеря данных;
- если в `tasks.metadata.completion_history` (Variant A в partial completion) лежит история — она автоматически сохраняется при архивации (Variant A архива). Минимум работы.
- если в `task_reports` (Variant B в partial completion) лежит история — нужно решить, копировать ли её в `task_reports_archive` или оставить ссылкой.

---

## 🚧 Перед промптом Claude Code

Андрей подтверждает:
- [ ] Variant A или B
- [ ] Унификация с /trash или раздельно
- [ ] Архивация неактивных задач разрешена
- [ ] Permanent delete из архива — нет (default) или да
- [ ] Snapshot имени работника в metadata — внедрять прямо сейчас
- [ ] `audit_log` для архивации — да/нет

После — промпт ≤15 строк.
