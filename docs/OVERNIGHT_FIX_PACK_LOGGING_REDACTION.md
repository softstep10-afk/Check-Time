# Alpha-7 Logging And Error Redaction

Scope: security cleanup for logs and error responses. This pack does not change business success/failure behavior, validation rules, route permissions, workflows, RLS, Storage policies, schema, migrations, payroll, GPS logic, archive/trash behavior, messages, tasks, or projects.

## What Was Changed

- Added `src/lib/safe-log.ts` with reusable redaction helpers.
- Redacts sensitive keys such as PIN, password, token, access token, refresh token, service-role key, database URL, authorization, cookie, API key, and signed URL fields.
- Redacts sensitive values inside text, including signed URLs, DB URLs, auth headers, JWT-like values, and token assignments.
- Converts logged `Error` objects to `{ name, message }` without stack traces.
- Jarvis provider/Gemini logs no longer include stack traces.
- Audit logs redact sensitive before/after payload fields before console fallback output.
- Mux transcode failures store and return redacted provider details.
- Mux webhook auth failure no longer returns signature-verification details.
- Voice input no longer logs final transcripts.
- GPS diagnostic logs no longer include full page URL and redact the browser error message.
- Task attachment logs redact filenames, MIME fallbacks, and Supabase errors.
- User-facing server-configuration errors no longer mention service-role environment variable names.

## What Was Not Changed

- No success/failure business behavior changed.
- No route permission or role logic changed.
- No payroll, salary archive, archive/trash, GPS/geofence/clock-in/clock-out, shift, message/task lifecycle, file type, Storage policy, RLS, schema, or migration behavior changed.
- Login still returns access/refresh tokens to the authenticated browser flow as required for the existing PIN session flow.
- Local scripts that intentionally inspect local environments remain local-only tooling and were not changed into app runtime behavior.

## Tests

- `tests/lib/safe-log.test.ts` covers redaction of PINs, tokens, service keys, DB URLs, signed URLs, JWT-like strings, auth headers, and error stack omission.

## Deferred

- Full server-route error response standardization across every API route.
- Replacing all client-side development diagnostics with a centralized debug logger.
- Secret scanning beyond the existing Alpha-7 static guard script.
- Production log review in Vercel/Supabase consoles.
- Any changes to auth/session semantics or PIN/team creation workflow.
