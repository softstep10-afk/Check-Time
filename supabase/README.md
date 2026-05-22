# Supabase artifacts

This directory holds everything that lives in the Supabase project (schema,
edge functions) but is checked into the same repo as the Next.js app.

```
supabase/
├── functions/
│   └── detect-store-visit/    ← Edge function (Deno) — Wave 2
└── migrations/
    ├── 00001_foundation.sql        (applied)
    ├── 00002_rls_policies.sql      (applied)
    ├── 00003_schema_gap.sql        (applied)
    ├── 00004_geofence_grace.sql    (NOT applied — see header)
    └── 00005_app_settings.sql      (NOT applied — see header)
```

Migrations 00004 and 00005 are intentionally COMMENTED. Open each file, read
the rationale at the top, then run it manually from the Supabase SQL editor
(or `supabase db push` after uncommenting).

---

## Edge function: `detect-store-visit`

State machine for the store-visit auto-detection feature (task 6 / wave 2).
Runs the geofence math on every new `worker_live_locations` row and writes
to `store_visits` (and best-effort `audit_log`).

### Local development

```sh
# Boot the function locally so you can hit it with `curl`.
supabase functions serve detect-store-visit
```

The function expects two env vars at runtime — both are auto-injected when
you deploy via `supabase functions deploy`, but you must export them in your
shell for the local `serve` command:

```sh
export SUPABASE_URL=https://<project-ref>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service-role-jwt>
```

> **Never commit the service-role key.** It bypasses RLS by design; treat it
> like a root password.

Optional request hardening:

```sh
export DETECT_STORE_VISIT_WEBHOOK_SECRET=<long-random-shared-secret>
```

When `DETECT_STORE_VISIT_WEBHOOK_SECRET` is set, every request must include
`x-check-time-webhook-secret: <same-secret>` or `Authorization: Bearer
<same-secret>`. Leaving it unset preserves the existing webhook behavior.

### Deploy

```sh
supabase functions deploy detect-store-visit --project-ref <project-ref>
```

### Wire the database webhook (one-time UI step)

Webhooks are not version-controlled by the Supabase CLI, so set this up once
in the dashboard. Replicate per environment (dev / staging / prod).

1. Go to **Database → Webhooks → Create a new hook**.
2. Fill in:
   - **Name:** `detect-store-visit-on-location`
   - **Table:** `public.worker_live_locations`
   - **Events:** check **Insert** only.
   - **Type:** `HTTP Request`
   - **Method:** `POST`
   - **URL:** `https://<project-ref>.functions.supabase.co/detect-store-visit`
   - **HTTP Headers:** add
     - `Authorization: Bearer <SUPABASE_ANON_KEY>` (Supabase requires this
       even though the function uses the service-role key internally)
     - `Content-Type: application/json`
     - Optional after setting `DETECT_STORE_VISIT_WEBHOOK_SECRET` on the
       function: `x-check-time-webhook-secret: <same-secret>`
   - **HTTP Params:** none.
   - **Payload:** leave the default `record` body — the function expects
     the standard `{ type, table, schema, record, old_record }` envelope.
3. Save. The first INSERT after this should produce a 200 in the webhook log
   and (if the worker is inside a fence) a row in `public.store_visits`.

### Smoke test

```sh
curl -X POST 'https://<project-ref>.functions.supabase.co/detect-store-visit' \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -H 'Content-Type: application/json' \
  -d '{
    "type": "INSERT",
    "table": "worker_live_locations",
    "schema": "public",
    "record": {
      "id": "00000000-0000-0000-0000-000000000abc",
      "org_id": "<your-org-uuid>",
      "worker_id": "<a-worker-uuid>",
      "shift_id": null,
      "lat": 37.7749,
      "lng": -122.4194,
      "recorded_at": "2026-04-19T12:00:00Z"
    }
  }'
```

Expected behaviour:

| Scenario | Response |
|---|---|
| Point outside any fence, no open visit | `{"ok":true,"action":"noop","detail":"outside-all"}` |
| Point inside a fence, no open visit | `{"ok":true,"action":"opened","detail":"<store name>"}` |
| Point inside same store as open visit | `{"ok":true,"action":"noop","detail":"still-inside"}` |
| Point in a different store | `{"ok":true,"action":"switched","detail":"<old> → <new>"}` |
| Point outside, first time | `{"ok":true,"action":"noop","detail":"grace-started"}` |
| Point outside, < 60s since grace started | `{"ok":true,"action":"noop","detail":"grace-pending"}` |
| Point outside, ≥ 60s and dwell ≥ 3min | `{"ok":true,"action":"closed_kept","detail":"<seconds>s"}` |
| Point outside, ≥ 60s and dwell < 3min | `{"ok":true,"action":"closed_dropped","detail":"<seconds>s"}` |

A `closed_kept` response also writes a `store_visit_logged` row to
`audit_log` so the Overview Recent Events feed can surface it.

### Failure modes worth knowing

- The function tolerates `app_settings` being missing — falls back to a 75m
  radius. Apply migration 00005 to expose the owner slider.
- The function tolerates `store_visits.grace_started_at` being missing —
  every "outside fence" point will close the visit immediately (no buffer).
  Apply migration 00004 to enable the 60s grace window.
- The function never blocks: errors return HTTP 500 with a JSON body so the
  webhook retry policy can decide what to do.

### Manual cleanup helpers

If a worker ends their shift without producing an exit point (rare, but
possible if GPS is dropped at the very moment they leave), the in-app
clock-out paths (`WorkerShell.clockOut` and `ForceCheckoutButton`) call
`closeOpenStoreVisits()` to close the visit using the clock-out timestamp.
No manual action required.
