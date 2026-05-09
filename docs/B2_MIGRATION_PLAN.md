# Media storage migration — Supabase Storage → Backblaze B2

Design document. No implementation. Supersedes nothing until a separate
implementation phase is approved.

**Status:** draft plan, awaiting approval to implement
**Prerequisite:** current Supabase storage bucket `media` is working
(see `STAGING_MOBILE_REPORT.md` + the pending `00016_storage_bucket.sql`
fix). Do not start this migration until that baseline is green.

---

## 0. Honest framing — is this worth doing?

Before touching any code, confirm the economics. Backblaze B2 vs
Supabase Storage today (Apr 2026, Hobby/Pro tiers):

| Line item | Supabase (Pro) | Backblaze B2 | Notes |
|-----------|----------------|--------------|-------|
| Storage at rest | ~$0.021/GB/mo | ~$0.006/GB/mo | B2 ~3.5× cheaper |
| Egress | $0.09/GB | $0.01/GB (or free via Bandwidth Alliance to Cloudflare) | B2 ~9× cheaper |
| Upload | free | free | same |
| Included with paid plan | 100 GB storage + 250 GB egress | nothing bundled | |
| Operational surface | 1 system | 2 systems | more to break |

**Break-even:** migrating pays for itself once monthly egress exceeds
roughly 100 GB (the bundled amount), or storage exceeds 100 GB. A
50-worker crew averaging 5 MB of photos/videos per day = ~7.5 GB/month
new data, reading a few GB back. At that scale, Supabase Storage is
cheaper than the engineering time to migrate.

**Recommended go/no-go:** only start this when ONE of the following is
true:
- Monthly Supabase egress bill is going to pass $20-30 (roughly 250 GB egress above included).
- Single uploads regularly exceed 50 MB (Supabase Pro file limit) — B2 supports much larger.
- Need to serve video with bandwidth-heavy patterns (CDN friendliness, hotlink-tolerance).
- Multi-provider redundancy is an explicit business requirement.

If none of those apply yet — keep this document, revisit in 6 months.

---

## 1. Target architecture

```
              ┌──────────────────────────────┐
              │ Browser (worker / manager)   │
              └──────────┬───────────────────┘
                         │
          ┌──────────────┴────────────────┐
          │                                │
          │ 1. POST /api/media/presigned   │ (Next.js route, Node runtime)
          │    with { projectId, filename, │
          │           size, mimeType }     │
          │                                │
          │ 2. Server checks RLS           │────▶ Supabase Postgres
          │    on tasks / project / user   │     (read-only probe)
          │                                │
          │ 3. Server generates presigned  │────▶ B2 S3-compatible API
          │    PUT URL (short TTL) + key   │     (HEAD bucket, nothing
          │                                │      written yet)
          │ 4. Server INSERTs media row    │────▶ Supabase Postgres
          │    status='uploading',         │     (media table)
          │    storage_provider='b2',      │
          │    storage_path=<b2 key>       │
          │                                │
          │ 5. Returns { mediaId,          │
          │              presignedUrl,     │
          │              key }             │
          └────┬───────────────────────────┘
               │
               │ 6. Browser PUT file directly to B2 presigned URL
               ▼
       ┌─────────────────┐
       │ Backblaze B2    │    (bytes land here;
       │ bucket: media   │     no Vercel bandwidth
       │ private         │     consumed)
       └─────────────────┘
               │
               │ 7. Browser POST /api/media/[id]/commit { etag }
               ▼
          Server flips media row status='ready', records etag
```

### Read path

```
  Browser requests media → Next route `/api/media/[id]/url`
  → server checks media RLS (SELECT returns row? OK)
  → server generates presigned GET URL (5-30 min TTL)
  → browser loads via that URL directly from B2
```

### Core design choices

- **S3-compatible API** (via `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`), **not native B2 API**. Portability: same code works against R2 / S3 / Wasabi if we ever switch again.
- **Server-signed, client-direct uploads.** Vercel never sees the bytes. Presigned URLs issued per-upload, TTL 5 minutes.
- **Server-signed, client-direct reads.** Same pattern; TTL 1 hour (re-requested on each view — cheap).
- **Authorization in the Next route.** The media table's existing RLS policies (`media_select_role_aware`, etc.) are the source of truth. The route queries the media row with the user's Supabase JWT — if the row comes back, access is granted; otherwise 403. B2 itself does NOT enforce access — the presigned URL is the gate.
- **Metadata stays in Supabase.** The `media` table schema barely changes: add `storage_provider text default 'supabase'` plus `etag text null` plus `upload_status text default 'ready' check (in ('uploading','ready','failed'))`.
- **Private bucket, no public URLs.** Every GET goes through the app so we can revoke access immediately if needed.
- **Bucket region chosen close to Vercel deployment region** (currently `pdx1` / `iad1` — use B2 `us-west-004` for pdx or `us-east-005` for iad).

---

## 2. Files / services that would change

### New files (code)

| File | Purpose |
|------|---------|
| `src/lib/storage/b2-client.ts` | S3 client factory (AWS SDK v3), reads env vars |
| `src/lib/storage/presign.ts` | `getUploadUrl({key, contentType, sizeLimit})`, `getDownloadUrl({key, ttl})` helpers |
| `src/lib/storage/provider.ts` | Dispatcher: looks at `media.storage_provider`, calls either B2 or Supabase. Used by read-side code. |
| `src/lib/storage/paths.ts` | Canonical key generator — `{orgId}/{projectId}/{YYYY-MM-DD}/{uuid}-{safeName}`. Used by both providers for consistency. |
| `src/app/api/media/presigned-upload/route.ts` | POST — returns `{ mediaId, presignedUrl, fields }`; inserts media row with `upload_status='uploading'` |
| `src/app/api/media/[id]/commit/route.ts` | POST — flips `upload_status='ready'`, records `etag`, `file_size` from request body |
| `src/app/api/media/[id]/url/route.ts` | GET — issues presigned GET URL after RLS check |

### Modified files (upload call sites — 7)

All of these currently do `supabase.storage.from("media").upload(...)` →
become `fetch("/api/media/presigned-upload").then(putFileToReturnedUrl).then(commit)`:

- `src/components/worker/WorkerShell.tsx` (two call sites — journal + offline drain)
- `src/components/manager/ProjectDetailPage.tsx` (two call sites — receipts upload + getPublicUrl after)
- `src/components/manager/SendMessageForm.tsx` (one call site + getPublicUrl)

Suggested refactor: extract an `uploadViaPresign(file, {projectId, kind}): Promise<{mediaId, url}>` helper so the call sites shrink to one line each. That helper lives in `src/lib/storage/upload-client.ts`.

### Modified files (read call sites — 3)

All `getPublicUrl` → `fetch("/api/media/[id]/url")`:

- `src/components/manager/ProjectDetailPage.tsx` (two call sites)
- `src/components/manager/SendMessageForm.tsx` (one call site — immediately after upload)

For message attachments + receipts stored on the `messages.attachment` / `media.metadata`, the stored value continues to be the media row's `id` — not the URL — so the presigned URL is re-fetched per render.

### Schema migration

New `supabase/migrations/00017_media_storage_provider.sql`:

```sql
alter table public.media
  add column if not exists storage_provider text not null default 'supabase'
    check (storage_provider in ('supabase', 'b2'));
alter table public.media
  add column if not exists upload_status text not null default 'ready'
    check (upload_status in ('uploading', 'ready', 'failed'));
alter table public.media
  add column if not exists etag text;

-- index for orphan cleanup job (uploading > 1h without commit)
create index if not exists idx_media_uploading
  on public.media(created_at)
  where upload_status = 'uploading';
```

No RLS change needed — existing `media` RLS already gates by org + role + project assignment.

### Infrastructure

| Resource | What |
|----------|------|
| **Backblaze B2 account** | Free tier = 10 GB storage + 1 GB/day download — enough for staging |
| **B2 bucket** `media` | Private, file lock off, default encryption on |
| **B2 Application Key** | Scoped to the `media` bucket only: listBuckets, readBuckets, listFiles, readFiles, writeFiles, deleteFiles. **Not** master key. |
| **CORS on the bucket** | Allow origins: staging Vercel URL + future prod URL. Methods: GET, PUT, HEAD. Headers: `*`. Max age: 3600. |
| **Vercel env vars** (new) | `B2_ENDPOINT`, `B2_REGION`, `B2_BUCKET`, `B2_KEY_ID`, `B2_APP_KEY` — all server-side (no NEXT_PUBLIC). Same five go into `.env.local` for dev. |

---

## 3. Upload flow — exact steps

Current (Supabase):
```
browser → supabase.storage.from("media").upload(path, file)
browser → supabase.from("media").insert({...})
```

New (B2, client-direct):
```
1. browser POSTs { filename, contentType, size, projectId, kind }
   to /api/media/presigned-upload
2. server:
   a. resolves user from Supabase session cookie
   b. validates { projectId } belongs to user's org and role allows upload
   c. generates canonical key: {orgId}/{projectId}/{YYYY-MM-DD}/{uuid}-{safeName}
   d. inserts media row: org_id, project_id, uploaded_by, storage_path=key,
      filename, file_size, mime_type, storage_provider='b2',
      upload_status='uploading', metadata={kind}
   e. calls @aws-sdk/s3-request-presigner.getSignedUrl({
        PutObjectCommand({ Bucket: B2_BUCKET, Key: key,
                           ContentType: contentType,
                           ContentLength: size }),
        expiresIn: 300  // 5 min
      })
   f. returns { mediaId, presignedUrl, key }
3. browser PUT file directly to presignedUrl with the matching
   Content-Type header. B2 responds 200 with ETag header.
4. browser POSTs { mediaId, etag } to /api/media/[id]/commit
5. server:
   a. verifies mediaId belongs to user (SELECT with user JWT)
   b. issues HEAD on B2 to confirm object exists, size matches
   c. updates media row: upload_status='ready', etag=<etag from HEAD>,
      file_size=<from HEAD>
6. UI now renders attachment as normal (fetches presigned GET URL
   via /api/media/[id]/url)
```

### Failure modes

| Stage | Failure | Handling |
|-------|---------|----------|
| 2b | RLS rejects | 403, no row inserted |
| 2e | B2 unreachable | 503, no row inserted |
| 3 | PUT fails or aborted | row remains `upload_status='uploading'` — orphan cleanup job deletes rows with `upload_status='uploading' AND created_at < now() - interval '1 hour'` |
| 5b | B2 HEAD says object missing | 409 Conflict, mark `upload_status='failed'` — client should retry from step 1 |
| Client loses session mid-upload | presigned URL still valid; server rejects commit (step 5a) | row becomes orphan, cleaned up |

---

## 4. Read / access flow — exact steps

Current:
```
browser → supabase.storage.from("media").getPublicUrl(path)  // returns the URL
browser → <img src={url}>  // browser follows URL; requires active Supabase session cookie
```

New:
```
1. browser (rendering a task card or gallery tile) has media.id
2. browser fetches /api/media/[id]/url
3. server:
   a. queries media row with user JWT (RLS filters)
   b. if absent → 404
   c. if storage_provider='supabase' → legacy path, return
      supabase.storage.from("media").createSignedUrl(storage_path, 3600)
   d. if storage_provider='b2' → generate B2 presigned GET URL with
      getSignedUrl(GetObjectCommand(...), expiresIn: 3600)
   e. returns { url, expiresAt }
4. browser caches the { url, expiresAt } client-side for reuse (don't
   refetch per render; refetch on expiry or explicit refresh)
5. <img src={url}> / <video src={url}> loads from B2 directly
```

For gallery-heavy pages (project detail, worker journal, manager receipts),
batch the URL lookups: `POST /api/media/urls` with `{ ids: [...] }` →
returns `Record<id, { url, expiresAt }>`. Reduces request count from
N to 1.

---

## 5. Migration path — existing Supabase media → B2

Three phases. Gated; each phase must be green before starting the next.

### Phase M0 — dual-provider support (zero migration, pure code change)

- Add `storage_provider` column (via 00017 migration above).
- Deploy code with provider dispatch. Every existing row is
  `storage_provider='supabase'` (default), so nothing changes
  functionally.
- All NEW uploads go to B2 (write path switches), `storage_provider='b2'`
  stored on the new rows.
- Read path branches on `storage_provider`: old stuff reads from Supabase,
  new stuff reads from B2.
- Validate: new uploads land in B2, old uploads still load. At least one
  week of normal use.

**Rollback M0:** revert code, set all new rows' `storage_provider='supabase'`
(there shouldn't be any real traffic yet). B2 bucket is idle, nothing to
undo on B2 side.

### Phase M1 — backfill old files into B2

One-shot background script (preferred: standalone Node script you run
locally; alternative: Supabase Edge Function, but long-running jobs on
edge are awkward).

Algorithm:
```
select id, storage_path from public.media
where storage_provider = 'supabase'
order by created_at asc;

for each row:
  download from Supabase Storage (service role client)
  hash sha256 of the bytes
  upload to B2 with same key (storage_path used verbatim)
  HEAD B2 object; confirm size matches
  update media row: storage_provider='b2', etag=<b2 etag>
  write entry to migration-log.csv: { id, old_provider, new_provider,
                                       sha256, status }
```

Operational notes:
- Run in batches of 100-500, sleep between to avoid rate limits.
- Idempotent: check if B2 key already exists before uploading.
- Resumable: re-running picks up where it left off (filter by
  `storage_provider='supabase'`).
- Keep Supabase files in place during this phase — we'll delete only
  after verification.

**Rollback M1:** set back `storage_provider='supabase'` on any row
where the B2 copy is suspect. Because Supabase files weren't touched,
recovery is immediate.

### Phase M2 — cutover + cleanup

Prerequisites:
- Phase M1 complete for 100% of rows.
- Migration log audited: sha256 matches for every file.
- At least 1 week of zero Supabase-read errors in production.

Actions:
- **Snapshot Supabase bucket first.** Use `supabase storage` CLI to
  export everything to local disk or another backup location. Keep
  that snapshot for ≥90 days.
- Delete Supabase Storage bucket contents (not the bucket itself, just
  the files).
- Remove Supabase storage code paths in read dispatcher (keep `storage_provider`
  column for audit trail, or drop it).
- Remove `storage.buckets` media bucket from Supabase if no other app
  uses it (Supabase won't re-create it on its own).

**Rollback M2:** restore from snapshot, flip dispatcher back to support
Supabase provider. Expensive if >1 TB but feasible.

---

## 6. Risks + rollback

### Risks

| # | Risk | Likelihood | Impact | Mitigation |
|---|------|------------|--------|-----------|
| R1 | B2 bucket CORS not configured — client uploads blocked | medium | high | Pre-config CORS before Phase M0. Test with a throwaway file. |
| R2 | Signed URL leaks via shared browser history | low | medium | 1h TTL on GET, 5min on PUT. Document that deep-linking expired URLs gives 403. |
| R3 | Server route becomes the bottleneck (single point every read goes through) | low | medium | Add batched `/api/media/urls` endpoint. Cache presigned URLs client-side until expiry. Worst case: scale Vercel functions. |
| R4 | RLS drift — app checks in Next route, not at Postgres RLS layer | medium | high | The Next route runs `supabase.from("media").select()` with the user's JWT — RLS IS enforced, same policies as today. Keep this pattern strict; don't pull anything from media with service role in the read path. |
| R5 | Orphan uploads (PUT to B2 succeeds, commit step fails) | medium | low | Cron job deletes `upload_status='uploading' AND created_at < now() - 1 hour` rows + their B2 objects. Also list-and-diff B2 bucket vs media table monthly. |
| R6 | Cost surprise — egress spike | low | medium | B2 has no hidden bandwidth billing (unlike some competitors). Monitor usage in B2 dashboard. Cap daily spend in B2 account settings. |
| R7 | Partial migration gets stuck halfway → confusing state | low | high | Migration script writes log; always re-runnable. Keep Supabase alive until fully migrated + verified. Abort button = just stop running the script. |
| R8 | Supabase storage deletion during M2 kills files not yet confirmed in B2 | low | critical | M2 has explicit "snapshot first, verify migration log 100% second, delete third" sequence. Never skip the snapshot. |
| R9 | AWS SDK bundle size bloats Vercel function cold start | low | low | Use tree-shakable `@aws-sdk/client-s3` modules only. Target Node runtime (not edge). Bundle size ~500KB — acceptable. |
| R10 | Key rotation burden (B2 App Key leaks) | low | medium | Bucket-scoped keys, not master. Rotate via B2 dashboard + Vercel env update. Zero downtime if old+new keys overlap for 1 hour during rotation. |

### Rollback decision tree

```
Issue found
  │
  ├─ In Phase M0 (dual support deployed, no data moved)?
  │   └─ Revert code commit. B2 unused. Zero data at risk.
  │
  ├─ In Phase M1 (backfill running)?
  │   └─ Kill the backfill script. Flip any suspect rows'
  │      storage_provider back to 'supabase'. Supabase files
  │      are still intact.
  │
  ├─ In Phase M2 (cutover done, Supabase files deleted)?
  │   └─ Restore Supabase bucket from snapshot. Flip all rows
  │      back to storage_provider='supabase'. Takes hours for
  │      large buckets but feasible.
  │
  └─ Post-M2 (Supabase code paths removed)?
      └─ Same as above, PLUS cherry-pick the pre-M2 code that
         had the Supabase dispatcher. Budget a day for this
         rollback.
```

### Pre-implementation gate

Before any code is written, these must be confirmed:

- [ ] Supabase storage bucket fix (00016) is deployed and validated in staging
- [ ] B2 account exists, bucket `media` exists, app key scoped, CORS set
- [ ] At least one test upload + read round-trip via the B2 console (manual, proves CORS + keys)
- [ ] Current monthly Supabase storage bill snapshot (baseline)
- [ ] Business case acknowledged: does the economics justify? (see section 0)

### Estimated effort (rough)

- Phase M0 code + review: 2-3 working days
- Phase M1 backfill script + first run: 1 day + wait time (depends on volume)
- Phase M2 cutover + cleanup: 0.5 day + snapshot + verification window
- Total: ~5 working days over 2-3 weeks of elapsed time

This is a real project, not a weekend task. Revisit section 0 before
scheduling.
