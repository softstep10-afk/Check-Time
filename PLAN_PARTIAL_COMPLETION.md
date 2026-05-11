# План: Частичное выполнение + история отчётов

**Статус:** дизайн-документ. Кода ещё нет. Ждём решения по схеме (см. ниже) перед промптом для Claude Code.

**Дата:** 9 мая 2026, ночная сессия.

---

## 🎯 Что мы делаем и зачем

Сейчас на задаче работает «бинарный» цикл: нажал «Отметить готовым» в модалке → задача завершена, конец истории. Это плохо ложится на реальную стройку:

- работник делает половину работы, заканчивает смену, хочет «отчитаться, но не закрывать»;
- через два дня приходит другой работник, делает ещё кусок, тоже отчитывается;
- следующий — закрывает полностью.

Сегодня всё это можно только записать одним финальным `completion_note` в `metadata` — то есть теряются промежуточные шаги, кто-что-когда сделал.

**Цель:** дать работнику два пути из модалки и хранить полную хронологию сабмитов на задаче.

---

## ✅ Что решено пользователем (поведение)

1. **В модалке завершения две финальные кнопки** (вместо одной):
   - **«Готово полностью»** — закрывает задачу (`status="done"`, `completed_at`, `completed_by` как сейчас).
   - **«Нужно доделать / Сохранить отчёт»** — задача **остаётся активной** (`status` не меняется или остаётся `in_progress`), но в её историю добавляется новая запись отчёта.

2. **Поле «что нужно доделать» — опциональное.** Можно прислать просто комментарий + фото без указания «остаётся».

3. **Сабмитов на одной задаче может быть много.** Каждый — отдельная запись в истории. Никаких overwrites.

4. **Owner тоже может закрыть задачу полностью** (например, когда проверил работу и решил «всё, хватит»). Owner-сабмит — тоже запись в истории, но с флагом отправителя.

5. **Внутренний вид задачи** (для работника **и** для owner/manager) показывает полную хронологию:
   - кто отправил отчёт (имя + аватар, если есть)
   - когда (timestamp)
   - текстовый комментарий
   - прикреплённые медиа (фото/видео/PDF)
   - флаг follow-up + текст «что осталось» (если был)
   - финальный статус сабмита: «отчёт» (партиал) / «полное выполнение» (финал)

6. **Нумерация сабмитов** — по `created_at` ASC. Финальный сабмит — последний и единственный, кто меняет `tasks.status`.

---

## 🗄 Варианты схемы — два альтернативных пути

### Вариант A: JSONB-массив в `tasks.metadata.completion_history`

Сейчас `tasks.metadata` — `jsonb NOT NULL`. В нём уже хранятся `completion_note`, `completion_media_ids`, `follow_up_required`, `completed_by_recorded` и т.д. (см. `src/lib/task-notifications.ts` → `buildTaskCompletionMetadata`).

Расширяем существующий contract:

```jsonc
{
  "completion_history": [
    {
      "id": "uuid-v4",                         // клиентский id для key={} в React
      "submitted_by": "<profiles.id>",
      "submitted_at": "2026-05-09T12:34:56Z",
      "kind": "report" | "final",              // тип сабмита
      "note": "Закончил левую стену...",       // опционально
      "media_ids": ["<media.id>", ...],        // опционально
      "follow_up_required": true,              // только в kind="report"
      "follow_up_note": "..."                  // опционально
    },
    ...
  ],
  // существующие поля сохраняются:
  "completion_note": "...",                    // последний final note (для совместимости)
  "completion_media_ids": [...],               // объединённый список ID для manager UI
  ...
}
```

**Плюсы:**
- Никаких новых таблиц / RLS-политик.
- Атомарная запись через один `UPDATE tasks SET metadata = ...` — одна транзакция.
- Существующие `getCompletionMediaIds`/`getCompletionNote`/`getFollowUpInfo` остаются совместимыми.
- Идеально для лёгкой истории (5–20 записей на задачу).

**Минусы:**
- Запросы «все отчёты за период по работнику» = `select ... from tasks where metadata->'completion_history' @> ...` — медленно на больших объёмах, нет индексов.
- Конкурентные сабмиты (двое работников отправляют одновременно) могут перезатереть массив — нужен паттерн `update ... set metadata = jsonb_set(metadata, '{completion_history}', metadata->'completion_history' || $new)` в одном запросе **с lock'ом строки**, иначе read-modify-write race.
- Размер `metadata` растёт без границ — несколько мегабайт jsonb на одной задаче возможны.

### Вариант B: отдельная таблица `task_reports`

```sql
create table public.task_reports (
  id              uuid primary key default gen_random_uuid(),
  task_id         uuid not null references public.tasks(id) on delete cascade,
  submitted_by    uuid not null references public.profiles(id) on delete restrict,
  submitted_at    timestamptz not null default now(),
  kind            text not null check (kind in ('report', 'final')),
  note            text,
  media_ids       uuid[],                        -- или ref на отдельную junction-таблицу
  follow_up_required boolean not null default false,
  follow_up_note  text,
  org_id          uuid not null references public.organizations(id),
  deleted_at      timestamptz
);

create index task_reports_task_id_submitted_at_idx
  on public.task_reports (task_id, submitted_at);
create index task_reports_submitted_by_submitted_at_idx
  on public.task_reports (submitted_by, submitted_at);

-- RLS:
alter table public.task_reports enable row level security;
-- Worker может читать reports для своих задач + общих задач на доступных проектах.
-- Worker может вставлять report со своим submitted_by.
-- Owner/Manager видят все в своей org_id.
```

**Плюсы:**
- Чистая нормализация: один report = одна строка.
- Натуральные индексы — быстрый поиск «отчёты за неделю по проекту X».
- Конкурентные вставки — никаких race condition.
- Удобно фильтровать в архиве и аудите.
- `tasks.metadata` остаётся чистым.

**Минусы:**
- Новая таблица + миграция + RLS-политики (примерно 4 политики: select для worker / manager, insert для worker, insert для manager).
- Двухступенчатая запись при сабмите: `INSERT INTO task_reports + UPDATE tasks (если final)` — хочется обернуть в транзакцию (проще через `rpc()` с серверной функцией).
- Пересмотр manager-side UI: `getCompletionMediaIds`/`getCompletionNote` больше не работают одной строкой — нужно join.

### Рекомендация — без выбора

Оба варианта нормально работают. **Если в течение 6–12 месяцев на одной задаче ожидается до 5–10 сабмитов**, Variant A проще и быстрее. **Если планируется аудит / отчёты по периодам / архив с фильтрами**, Variant B даёт лучше масштабируемость и чистоту запросов.

User-decision-point.

---

## 📁 Что трогаем (любой из вариантов)

### UI

- **`src/components/worker/WorkerTaskDetailModal.tsx`**
  - Заменить одну кнопку «Отметить готовым» на две: «Готово полностью» (брендовый жёлтый) и «Нужно доделать / Сохранить отчёт» (вторичная серо-янтарная).
  - В модалке отдельным блоком сверху — рендер существующей истории (если уже были сабмиты).
  - Тип `WorkerTaskCompletionPayload` расширить: `kind: "report" | "final"`.

- **`src/components/worker/TasksPage.tsx`**
  - Колбэк `onDone` принимает `kind`. Если `kind === "final"` — текущий путь (instant-flip через `locallyCompletedTaskIds`). Если `"report"` — никакого flip'а; задача остаётся в активных, но банер «Отчёт сохранён» показываем.

- **`src/components/worker/WorkerProjectView.tsx`**
  - То же самое для project view: `markLocalTask` только при `kind === "final"`.

- **Manager-side**:
  - `src/components/manager/ManagerTasksPage.tsx` — карточка задачи показывает количество отчётов («3 отчёта») как badge.
  - `src/components/manager/ProjectDetailPage.tsx` (внутренний task-row) — то же.
  - **Новый компонент** `TaskHistoryView` (shared) — рендерит список сабмитов с авторством, медиа-таилами и follow-up-флагами. Используется в обеих модалках (worker + manager).

### Логика

- **`src/components/worker/WorkerShell.tsx` → `updateTaskStatus`**
  - Сейчас: одна функция, ветвится по `nextStatus === "done"`.
  - После: разделить на два явных ввода — `submitTaskFinal()` и `submitTaskReport()`. Или один с явным `kind`.
  - При `kind === "report"`: НЕ менять `tasks.status`, НЕ ставить `completed_at`, НЕ ставить `completed_by`. Только дополнить историю.
  - Guard `submittedFromCompletionModal: true` сохраняется — он защищает от done-мутаций мимо модалки. Для `report` свой guard не нужен (нет завершения).

- **`src/lib/worker-task-ui.ts`**
  - `submitWorkerTaskCompletion` → переименовать в `submitWorkerTaskFinal`, добавить `submitWorkerTaskReport`. Или оставить одно имя, добавить параметр `kind`.

- **`src/lib/task-notifications.ts`**
  - `buildTaskCompletionMetadata` — научить добавлять запись в `completion_history` (Variant A) или вернуть просто данные для отдельного INSERT в `task_reports` (Variant B).
  - `getCompletionMediaIds`/`getFollowUpInfo` — обновить чтобы возвращали LATEST report или агрегированный список.

### Данные / запросы

- **`src/app/(worker)/project/[id]/page.tsx`** (SSR-загрузчик задач) — подтягивать историю отчётов вместе с задачами (LEFT JOIN или второй запрос).
- **`src/lib/worker-data.ts`** (`/my-tasks` SSR) — то же.
- **`src/lib/manager-data.ts`** — то же для manager-side.

### RLS

- **Variant A**: ничего не меняется (history в `tasks.metadata`, существующие task RLS уже регулируют).
- **Variant B**: добавить миграцию с политиками `task_reports`:
  - `SELECT`: worker видит свои + report'ы на доступных проектах; manager/owner — всё в org_id.
  - `INSERT`: worker — только `submitted_by = auth.uid()` и task должна быть видима; manager/owner — что угодно в своей org_id.
  - `UPDATE/DELETE`: запретить (история неизменяема). Soft-delete через `deleted_at` только для admin/owner.

### Тесты (vitest)

- **`tests/lib/task-completion-flow.test.ts`** — расширить:
  - report-сабмит не меняет `status`.
  - final-сабмит после двух report'ов закрывает задачу.
  - история видна обоим: и работнику и менеджеру.
- Новый тест `tests/lib/task-reports-rls.test.ts` (для Variant B) — проверить что воркер не видит чужие отчёты.

---

## ❓ Открытые вопросы — нужны ответы перед стартом

1. **Variant A или Variant B?** (см. выше). Если не знаешь — мой совет: начнём с A для скорости, перейдём на B при первой потребности в аудит-фильтрах. Миграция A→B сводится к INSERT'ам из jsonb-массива, обратное сложнее.

2. **Может ли owner сделать партиал (kind="report") или ему доступен только final?** Сейчас сценарий: «owner проверяет работу и закрывает» — это явно final. Но он мог бы и оставить заметку «надо ещё подкрасить» — это report. **Я бы оставил обе опции, owner-side кнопки тоже две.** Подтверди.

3. **Show history above the form, or in a separate tab/accordion?** Если истории нет — пусто. Если 1–2 записи — компактно сверху перед формой. Если 5+ — собирать в свёрнутый блок. **Решение: рендерить компактным списком сверху, при количестве >3 свернуть в «Показать ещё N отчётов».**

4. **Нотификации.** Сейчас `WorkerShell` подписан на INSERT в `tasks` — даёт banner для new-task. На report-сабмит owner должен получать уведомление? **Предполагаю: да — owner видит badge на bell, при клике открывает задачу с историей.** Это требует доп. realtime-подписки (на Variant B — на `task_reports`, на A — на `tasks` UPDATE с фильтром по metadata diff, что сложнее).

5. **«что осталось» — обязательно для report?** Сейчас спека говорит — опционально. **Ок, оставляем как есть.** Но в UI поле «осталось» появляется только при чекбоксе «нужно доделать», иначе просто комментарий+медиа.

6. **Удаление прошлых report'ов.** Может ли работник «отозвать» свой отчёт? **Я бы запретил — отчёты иммутабельны, audit trail.** Если ошибся — пишет новый report с пометкой «отзываю предыдущий».

7. **Связь с уже существующим `completion_note` / `completion_media_ids`.** При миграции на новую модель: нужно ли мигрировать существующие completion-данные в формат истории? **Предполагаю: да, одна синтетическая запись `kind: "final"` со старыми полями — иначе старые задачи будут выглядеть «без истории» в новом UI.** Подтверди.

---

## 📦 Объём работы (грубая прикидка)

- **Variant A:** ~1 волна Claude Code (45–60 мин). Миграция не нужна, только код.
- **Variant B:** ~1.5 волны (миграция + RLS + код + тесты). Безопаснее разбить на 2 волны: миграция отдельной волной, UI отдельной.

В обоих случаях рекомендую сначала провести **отдельный шаг данных** (одна синтетическая history-запись для каждой существующей завершённой задачи), потом — UI.

---

## 🚧 Перед промптом Claude Code

Андрей подтверждает:
- [ ] Variant A или B
- [ ] Owner может report или только final
- [ ] Миграция старых completion в history — да/нет
- [ ] Нотификации owner на report — да/нет
- [ ] Удаление report'ов — запрещено (default) или разрешено

После подтверждения готовим промпт ≤15 строк по эталону `IMPLEMENTATION_PLAN.md`.
