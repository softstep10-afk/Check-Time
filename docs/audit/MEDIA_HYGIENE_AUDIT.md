# Media Table Hygiene Audit + Safe Normalization Runbook

**Scope:** `public.media` only — every row used by project_media,
task_attachment, receipt, worker_journal, checkout video.
**Prereq:** runtime helper `normalizeStoragePath()` already exists in
`src/lib/task-attachments.ts` (commit `76e4759`) and is wired into
`TaskAttachmentList.open()` + `ProjectDetailPage.openProjectMediaItem`.
This SQL runbook normalizes the data **at rest** so future code paths
don't need the runtime fallback.

**No schema change. No upload-logic change. No UI change. SELECT-only
audit + transactional normalization with explicit rollback path.**

Run every step in the **Supabase SQL Editor** for project
`vlrajjwbaxikbwvqdpft`. Stop and ping me if any step output looks
unexpected.

---

## Step 1 — Audit (read-only)

Run all 10 queries. Save the output (screenshot or copy/paste). Each
query's purpose is in the comment.

```sql
-- A1. Distribution by metadata.kind
select
  coalesce(metadata->>'kind', '<null>') as kind,
  count(*) as rows
from public.media
group by 1
order by rows desc;

-- A2. Cross-tab kind × media_type (look for mismatches)
select
  coalesce(metadata->>'kind', '<null>') as kind,
  media_type,
  count(*) as rows
from public.media
group by 1, 2
order by 1, 2;

-- A3. storage_path format anomalies
select
  case
    when storage_path is null         then 'NULL_PATH'
    when storage_path = ''            then 'EMPTY_PATH'
    when storage_path like '/media/%' then 'SLASH_AND_BUCKET_PREFIX'
    when storage_path like '/%'       then 'LEADING_SLASH'
    when storage_path like 'media/%'  then 'BUCKET_PREFIX'
    when storage_path !~ '^[a-zA-Z0-9-]+/'
                                      then 'WEIRD_PREFIX'
    else 'CLEAN'
  end as path_form,
  count(*) as rows
from public.media
group by 1
order by rows desc;

-- A4. mime_type quality
select
  case
    when mime_type is null                       then 'NULL_MIME'
    when mime_type = ''                          then 'EMPTY_MIME'
    when mime_type = 'application/octet-stream'  then 'OCTET_STREAM'
    else 'OK'
  end as mime_status,
  count(*) as rows
from public.media
group by 1
order by rows desc;

-- A5. mime_type vs filename extension mismatches
select
  media_type,
  mime_type,
  case
    when filename ilike '%.pdf' then 'pdf'
    when filename ilike any(array['%.jpg','%.jpeg','%.png','%.heic','%.heif','%.webp','%.gif']) then 'photo'
    when filename ilike any(array['%.mp4','%.mov','%.webm']) then 'video'
    else 'unknown'
  end as inferred_from_ext,
  count(*) as rows
from public.media
where filename is not null
group by 1, 2, 3
order by rows desc;

-- A6. media_type rows that should be reclassified
select id, media_type, mime_type, filename, storage_path
from public.media
where
  (media_type = 'photo'    and (filename ilike '%.pdf' or mime_type = 'application/pdf'))
  or (media_type = 'document' and (filename ilike '%.pdf' or mime_type = 'application/pdf'))
  or (media_type = 'video'    and (filename ilike any(array['%.jpg','%.jpeg','%.png']) or mime_type like 'image/%'))
limit 50;

-- A7. Orphan: media linked to a deleted/missing project
select
  case
    when project_id is null
      then 'NO_PROJECT'
    when not exists (select 1 from public.projects p where p.id = m.project_id)
      then 'PROJECT_DELETED'
    else 'OK'
  end as project_status,
  count(*) as rows
from public.media m
group by 1;

-- A8. task_attachment rows not referenced by any task.metadata.attachment_media_ids[]
select m.id, m.storage_path, m.created_at
from public.media m
where (m.metadata->>'kind') = 'task_attachment'
  and not exists (
    select 1 from public.tasks t
    where t.metadata->'attachment_media_ids' ? m.id::text
  )
limit 50;

-- A9. Capacity per kind
select
  coalesce(metadata->>'kind', '<null>') as kind,
  count(*) as rows,
  pg_size_pretty(sum(file_size)) as total_size,
  pg_size_pretty(avg(file_size)::bigint) as avg_size
from public.media
where file_size is not null
group by 1
order by sum(file_size) desc;

-- A10. Sample 5 latest rows per category for human eyeball
(select 'project_media'   as cat, id, media_type, mime_type, filename, storage_path, created_at
  from public.media where (metadata->>'kind') = 'project_media'    order by created_at desc limit 5)
union all
(select 'task_attachment',         id, media_type, mime_type, filename, storage_path, created_at
  from public.media where (metadata->>'kind') = 'task_attachment'  order by created_at desc limit 5)
union all
(select 'receipt',                 id, media_type, mime_type, filename, storage_path, created_at
  from public.media where (metadata->>'kind') = 'receipt'          order by created_at desc limit 5)
union all
(select 'no_kind',                 id, media_type, mime_type, filename, storage_path, created_at
  from public.media where (metadata->>'kind') is null              order by created_at desc limit 5);
```

### What "broken" looks like in A1-A10 output

- **A3 path_form ≠ CLEAN** → row has malformed `storage_path` that the runtime helper currently masks; DB normalization fixes it permanently
- **A4 mime_status ≠ OK** → row will produce wrong-looking thumbnails / wrong viewer routing
- **A5 inferred_from_ext ≠ matches media_type** → row's `media_type` enum is wrong (will end up in the wrong filter tab)
- **A6 returns rows** → those rows have outright wrong `media_type` (PDF labeled as photo, etc.)
- **A7 PROJECT_DELETED** → orphan media (do NOT delete; just report)
- **A8 returns rows** → task attachments uploaded but never linked to a task (orphan from failed inserts; safe to leave)
- **A10 no_kind > 0** → legacy rows missing `metadata.kind` — the normalization will infer it from `storage_path`

---

## Step 2 — Dry-run (read-only)

Computes what the normalizer **would** write. **No UPDATE.** Look at
the proposed changes and confirm before running Step 3.

```sql
-- Dry-run: every row that would change, with old → new for each field
with proposed as (
  select
    id,
    storage_path as old_path,
    regexp_replace(regexp_replace(coalesce(storage_path, ''), '^/', ''), '^media/', '') as new_path,

    media_type as old_media_type,
    coalesce(
      case when media_type in ('photo','video','pdf') then media_type end,
      case when mime_type like 'image/%'                          then 'photo'::text end,
      case when mime_type like 'video/%'                          then 'video'::text end,
      case when mime_type = 'application/pdf'                     then 'pdf'::text   end,
      case when filename ilike any(array['%.jpg','%.jpeg','%.png','%.heic','%.heif','%.webp','%.gif']) then 'photo'::text end,
      case when filename ilike any(array['%.mp4','%.mov','%.webm']) then 'video'::text end,
      case when filename ilike '%.pdf'                            then 'pdf'::text   end,
      'document'::text
    ) as new_media_type,

    mime_type as old_mime_type,
    coalesce(
      nullif(nullif(mime_type, ''), 'application/octet-stream'),
      case when filename ilike '%.pdf'                            then 'application/pdf'      end,
      case when filename ilike any(array['%.jpg','%.jpeg'])       then 'image/jpeg'           end,
      case when filename ilike '%.png'                            then 'image/png'            end,
      case when filename ilike any(array['%.heic','%.heif'])      then 'image/heic'           end,
      case when filename ilike '%.webp'                           then 'image/webp'           end,
      case when filename ilike '%.gif'                            then 'image/gif'            end,
      case when filename ilike '%.mp4'                            then 'video/mp4'            end,
      case when filename ilike '%.mov'                            then 'video/quicktime'      end,
      case when filename ilike '%.webm'                           then 'video/webm'           end,
      mime_type
    ) as new_mime_type,

    metadata->>'kind' as old_kind,
    coalesce(
      metadata->>'kind',
      case when storage_path like '%/project-media/%' then 'project_media'   end,
      case when storage_path like '%/tasks/%'         then 'task_attachment' end,
      case when storage_path like '%/receipts/%'      then 'receipt'         end,
      case when (metadata->>'category') = 'receipt'   then 'receipt'         end,
      case when (metadata->>'kind') = 'before_leave'  then 'worker_journal'  end,
      case when is_checkout = true                    then 'worker_journal'  end
    ) as new_kind
  from public.media
)
select
  id,
  case when old_path is distinct from new_path
       then '⚠️  ' || coalesce(old_path, '<null>') || '  →  ' || new_path else '·' end as path_change,
  case when old_media_type is distinct from new_media_type
       then '⚠️  ' || coalesce(old_media_type::text, '<null>') || '  →  ' || new_media_type else '·' end as media_type_change,
  case when old_mime_type is distinct from new_mime_type
       then '⚠️  ' || coalesce(old_mime_type, '<null>') || '  →  ' || coalesce(new_mime_type, '<null>') else '·' end as mime_type_change,
  case when old_kind is distinct from new_kind
       then '⚠️  ' || coalesce(old_kind, '<null>') || '  →  ' || coalesce(new_kind, '<null>') else '·' end as kind_change
from proposed
where old_path        is distinct from new_path
   or old_media_type  is distinct from new_media_type
   or old_mime_type   is distinct from new_mime_type
   or old_kind        is distinct from new_kind
order by id
limit 200;

-- Total count of rows that would change
with proposed as (
  -- (same CTE as above — copy it)
)
select count(*) as rows_that_would_change
from proposed
where old_path        is distinct from new_path
   or old_media_type  is distinct from new_media_type
   or old_mime_type   is distinct from new_mime_type
   or old_kind        is distinct from new_kind;
```

**Decision gate:** if the dry-run output looks reasonable (you eyeball
the 200 rows + total count, nothing bizarre), proceed to Step 3. If
anything looks wrong, **stop** and ping me with the unexpected
output before continuing.

---

## Step 3 — Safe apply (transactional)

Wraps the update in a `begin … commit` so you can `rollback` if
anything looks off in the same session. Also creates a **temporary
backup** that lives for the duration of the SQL Editor session.

```sql
begin;

-- ─── Backup snapshot ───────────────────────────────────────────────
-- Lives only until you close this SQL Editor tab. For a longer-lived
-- backup, dump it to a real table:
--   create table public.media_backup_2026_04_22 as select * from public.media;
create temporary table media_backup_session as
select * from public.media;

-- Sanity check — same row count
select 'live'   as src, count(*) from public.media
union all
select 'backup', count(*) from media_backup_session;

-- ─── Apply normalization ──────────────────────────────────────────
update public.media as m
set
  storage_path = regexp_replace(regexp_replace(coalesce(m.storage_path, ''), '^/', ''), '^media/', ''),

  media_type = coalesce(
      case when m.media_type in ('photo','video','pdf') then m.media_type end,
      case when m.mime_type like 'image/%'                          then 'photo'::media_type end,
      case when m.mime_type like 'video/%'                          then 'video'::media_type end,
      case when m.mime_type = 'application/pdf'                     then 'pdf'::media_type   end,
      case when m.filename ilike any(array['%.jpg','%.jpeg','%.png','%.heic','%.heif','%.webp','%.gif']) then 'photo'::media_type end,
      case when m.filename ilike any(array['%.mp4','%.mov','%.webm']) then 'video'::media_type end,
      case when m.filename ilike '%.pdf'                            then 'pdf'::media_type   end,
      'document'::media_type
  ),

  mime_type = coalesce(
      nullif(nullif(m.mime_type, ''), 'application/octet-stream'),
      case when m.filename ilike '%.pdf'                            then 'application/pdf'      end,
      case when m.filename ilike any(array['%.jpg','%.jpeg'])       then 'image/jpeg'           end,
      case when m.filename ilike '%.png'                            then 'image/png'            end,
      case when m.filename ilike any(array['%.heic','%.heif'])      then 'image/heic'           end,
      case when m.filename ilike '%.webp'                           then 'image/webp'           end,
      case when m.filename ilike '%.gif'                            then 'image/gif'            end,
      case when m.filename ilike '%.mp4'                            then 'video/mp4'            end,
      case when m.filename ilike '%.mov'                            then 'video/quicktime'      end,
      case when m.filename ilike '%.webm'                           then 'video/webm'           end,
      m.mime_type
  ),

  -- Only fill kind if currently null/missing — never overwrite an
  -- existing kind (project_media / task_attachment / receipt etc.
  -- are intentionally written by the upload code).
  metadata = case
    when m.metadata is null
      then jsonb_build_object('kind', coalesce(
        case when m.storage_path like '%/project-media/%' then 'project_media'   end,
        case when m.storage_path like '%/tasks/%'         then 'task_attachment' end,
        case when m.storage_path like '%/receipts/%'      then 'receipt'         end,
        case when m.is_checkout = true                    then 'worker_journal'  end,
        'unknown'
      ))
    when (m.metadata->>'kind') is null
      then jsonb_set(m.metadata, '{kind}', to_jsonb(coalesce(
        case when m.storage_path like '%/project-media/%' then 'project_media'   end,
        case when m.storage_path like '%/tasks/%'         then 'task_attachment' end,
        case when m.storage_path like '%/receipts/%'      then 'receipt'         end,
        case when (m.metadata->>'category') = 'receipt'   then 'receipt'         end,
        case when (m.metadata->>'kind') = 'before_leave'  then 'worker_journal'  end,
        case when m.is_checkout = true                    then 'worker_journal'  end,
        'unknown'
      )))
    else m.metadata
  end;

-- ─── Verify the change ────────────────────────────────────────────
-- Count what changed vs backup
select
  'path'  as field,
  count(*) filter (where m.storage_path is distinct from b.storage_path) as changed
from public.media m
join media_backup_session b on b.id = m.id
union all
select 'media_type',
  count(*) filter (where m.media_type is distinct from b.media_type)
from public.media m
join media_backup_session b on b.id = m.id
union all
select 'mime_type',
  count(*) filter (where m.mime_type is distinct from b.mime_type)
from public.media m
join media_backup_session b on b.id = m.id
union all
select 'kind',
  count(*) filter (where (m.metadata->>'kind') is distinct from (b.metadata->>'kind'))
from public.media m
join media_backup_session b on b.id = m.id;

-- Inspect 20 rows that changed
select m.id,
  m.storage_path     as new_path,    b.storage_path     as old_path,
  m.media_type       as new_type,    b.media_type       as old_type,
  m.mime_type        as new_mime,    b.mime_type        as old_mime,
  (m.metadata->>'kind') as new_kind, (b.metadata->>'kind') as old_kind
from public.media m
join media_backup_session b on b.id = m.id
where m.storage_path     is distinct from b.storage_path
   or m.media_type       is distinct from b.media_type
   or m.mime_type        is distinct from b.mime_type
   or (m.metadata->>'kind') is distinct from (b.metadata->>'kind')
order by m.id
limit 20;

-- ─── DECISION POINT ───────────────────────────────────────────────
-- Reads above look good?  Run:           commit;
-- Reads above look wrong? Run:           rollback;
--
-- Until you run one or the other, the transaction is OPEN. Don't
-- close the SQL Editor tab without committing or rolling back.
```

**After commit:** the temporary backup table evaporates with the
session. If you want a longer-lived safety net (24-72h), uncomment
the `create table public.media_backup_2026_04_22` line at the top of
the block before running the transaction. Drop that table once you're
confident the data is good (`drop table public.media_backup_2026_04_22`).

---

## Step 4 — Rollback plan

Three rollback levels, in order from cheapest to nuclear:

**A. Mid-transaction (Step 3, before commit):**
```sql
rollback;
```
Zero risk. Nothing was committed. Backup table also vanishes.

**B. Post-commit, within session (Step 3 ran with the longer-lived backup table):**
```sql
begin;

update public.media as m
set
  storage_path = b.storage_path,
  media_type   = b.media_type,
  mime_type    = b.mime_type,
  metadata     = b.metadata
from public.media_backup_2026_04_22 as b
where b.id = m.id;

-- Verify count restored
select count(*) from public.media;
select count(*) from public.media_backup_2026_04_22;

-- Spot-check a few
select id, storage_path, media_type, mime_type, metadata
from public.media
order by random()
limit 10;

-- If anything off:    rollback;
-- Otherwise:          commit;

drop table public.media_backup_2026_04_22;
```

**C. Catastrophic (no backup table, beyond session):**
Restore from the most recent Supabase point-in-time backup via the
Supabase dashboard. Supabase Pro plan has 7-day PITR; Free has daily
snapshots only. You'd lose any non-media writes since the snapshot —
not great. Hence the recommendation to always create the
longer-lived backup table in Step 3.

---

## Step 5 — Confirmation: existing flows are not affected

The normalization preserves every field that the running code reads.
Specifically:

| Surface | Reads | Effect of normalization |
|---------|-------|------------------------|
| Project Media list (manager `/projects/[id]`) | filters by `metadata.kind = 'project_media'`; renders `media_type`, `filename`, `storage_path` | rows that previously lacked `kind` but had `/project-media/` in path now get the right kind → **start showing up correctly** in the panel. Already-correct rows untouched. |
| Project Media open (TaskAttachmentList + openProjectMediaItem) | `storage_path` → `normalizeStoragePath()` → `createSignedUrl()` | runtime helper still applies, AND data at rest is now clean → `normalizeStoragePath` becomes a no-op for fresh data |
| Task attachments list | `tasks.metadata.attachment_media_ids[]` → `media` rows | unchanged. Task references rows by `id`, not by `storage_path` or kind. |
| Receipts panel (manager) | filters by `metadata.category = 'receipt'` | unchanged. We only touch `metadata.kind`, never `metadata.category` (or any other key). Existing receipt rows keep both, new ones write both since commit `4e0df51`. |
| Worker journal | reads worker's own media | unchanged. We don't touch `uploaded_by`. |
| Worker `/project/[id]` | filters by `metadata.kind = 'project_media'` | same upgrade as manager Project Media — rows that should appear but didn't because they lacked `kind` will now appear. |
| Media flags | flags by `media_id` | unchanged. We don't touch `media.id`. |

**Things we explicitly do NOT change:**
- `id`, `org_id`, `project_id`, `uploaded_by`, `time_event_id`, `is_checkout`, `caption`, `created_at`, `deleted_at`, `ai_analysis`, `file_size`
- `metadata` keys other than `kind` (so `category`, `store_name`, `amount`, `purchase_date`, `task_id`, `attachment_media_ids` references, etc., all preserved)
- The bucket `media` itself, RLS policies, storage objects on disk
- Any other table

**Schema:** zero `ALTER` statements. No migration. Pure data-side
UPDATE inside one transaction.

---

## Optional: helper already exists

`normalizeStoragePath()` was added in commit `76e4759` to
`src/lib/task-attachments.ts`:

```ts
export function normalizeStoragePath(raw: string): string {
  let p = raw.trim();
  if (p.startsWith("/")) p = p.slice(1);
  if (p.startsWith("media/")) p = p.slice("media/".length);
  return p;
}
```

Already imported and applied at every signed-URL call site:
- `src/components/shared/TaskAttachmentList.tsx` `open()`
- `src/components/manager/ProjectDetailPage.tsx` `openProjectMediaItem()`

This DB normalization complements (not replaces) the runtime helper.
After Step 3, the helper becomes a no-op for newly-clean data; it
keeps protecting against any future malformed paths that slip in.

If you ever need it elsewhere (server scripts, edge functions,
notebooks), `import { normalizeStoragePath } from "@/lib/task-attachments"`.
