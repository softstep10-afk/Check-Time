# Alpha-7 Route Mutation Guard Map

Static local scan only. This report is not proof of vulnerability and does not call production.

| Path | Classification | Risk | Evidence |
| --- | --- | --- | --- |
| `src/app/api/ai/actions/create-project/route.ts` | projects sensitive | confirmed guarded | revalidatePath, createAdminClient, role checks, guard/assert helper, org/company guard |
| `src/app/api/ai/actions/create-task/route.ts` | tasks/messages sensitive | confirmed guarded | revalidatePath, createAdminClient, role checks, org/company guard |
| `src/app/api/ai/assistant/route.ts` | mutation | needs manual review | .update(, role checks, profile lookup |
| `src/app/api/ai/daily-report/route.ts` | mutation | needs manual review | .insert(, org/company guard |
| `src/app/api/ai/memory/route.ts` | mutation | dangerous unknown | .update( |
| `src/app/api/ai/photo-analysis/route.ts` | elevated mutation | confirmed guarded | .update(, createAdminClient, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/ai/realtime/connect/route.ts` | read-only | confirmed guarded | none |
| `src/app/api/ai/realtime/token/route.ts` | read-only | confirmed guarded | none |
| `src/app/api/ai/settings/route.ts` | mutation | needs manual review | .update(, role checks |
| `src/app/api/ai/voice-command/route.ts` | read-only | confirmed guarded | role checks |
| `src/app/api/ai/voice/route.ts` | mutation | needs manual review | .update(, role checks, profile lookup |
| `src/app/api/auth/pin-login/route.ts` | team/auth sensitive | needs manual review | auth.admin, createAdminClient, auth.admin, role checks, profile lookup |
| `src/app/api/manager/message-tasks/route.ts` | tasks/messages sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/manager/projects/[id]/archive/route.ts` | payroll/archive/GPS sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/manager/projects/[id]/planning/route.ts` | projects sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/manager/projects/[id]/route.ts` | projects sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/manager/projects/geocode/route.ts` | read-only | confirmed guarded | profile lookup, guard/assert helper |
| `src/app/api/manager/projects/route.ts` | projects sensitive | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/manager/tasks/route.ts` | tasks/messages sensitive | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/media/[id]/route.ts` | read-only | confirmed guarded | createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/media/mux-webhook/route.ts` | storage/media mutation | confirmed guarded | .update(, createAdminClient, service role, role checks, org/company guard |
| `src/app/api/media/transcode/route.ts` | storage/media mutation | confirmed guarded | .update(, createAdminClient, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/payroll/export/route.ts` | read-only | confirmed guarded | role checks, profile lookup, guard/assert helper |
| `src/app/api/payroll/run/route.ts` | payroll/archive/GPS sensitive | confirmed guarded | .insert(, .update(, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/schedule/route.ts` | elevated mutation | confirmed guarded | .insert(, .update(, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/team/create/route.ts` | team/auth sensitive | confirmed guarded | .insert(, auth.admin, createAdminClient, auth.admin, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/team/delete/route.ts` | team/auth sensitive | confirmed guarded | .update(, auth.admin, createAdminClient, auth.admin, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/team/pay-worker/route.ts` | team/auth sensitive | confirmed guarded | .insert(, .update(, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/team/reset-pin/route.ts` | team/auth sensitive | confirmed guarded | .update(, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/worker/claim-task/route.ts` | tasks/messages sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, service role, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/worker/clock-out/route.ts` | payroll/archive/GPS sensitive | confirmed guarded | .insert(, .update(, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/worker/jarvis/route.ts` | read-only | confirmed guarded | none |
| `src/app/api/worker/link-checkin-video/route.ts` | read-only | confirmed guarded | createAdminClient, service role, role checks, profile lookup, guard/assert helper |
| `src/app/api/worker/link-checkout-video/route.ts` | read-only | confirmed guarded | createAdminClient, service role, role checks, profile lookup, guard/assert helper |
| `src/app/api/worker/project-tasks/route.ts` | projects sensitive | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/app/api/worker/tasks/seen/route.ts` | tasks/messages sensitive | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, org/company guard |
| `src/lib/ai/action-endpoints.ts` | read-only | confirmed guarded | none |
| `src/lib/ai/api-auth.ts` | read-only | confirmed guarded | profile lookup, guard/assert helper |
| `src/lib/ai/data.ts` | read-only | confirmed guarded | profile lookup |
| `src/lib/ai/google-tts.ts` | read-only | confirmed guarded | none |
| `src/lib/ai/jarvis-config.ts` | read-only | confirmed guarded | none |
| `src/lib/ai/jarvis-diagnostics.ts` | read-only | confirmed guarded | none |
| `src/lib/ai/jarvis-memory.ts` | read-only | confirmed guarded | role checks, profile lookup |
| `src/lib/ai/jarvis-voice.ts` | read-only | confirmed guarded | profile lookup |
| `src/lib/ai/prepared-action-audit.ts` | read-only | confirmed guarded | role checks, profile lookup, org/company guard |
| `src/lib/ai/provider-routing.ts` | read-only | confirmed guarded | none |
| `src/lib/ai/service.ts` | read-only | confirmed guarded | role checks |
| `src/lib/ai/types.ts` | read-only | confirmed guarded | role checks |
| `src/lib/ai/washington-code-knowledge.ts` | read-only | confirmed guarded | none |
| `src/lib/annual-report-utils.ts` | read-only | confirmed guarded | none |
| `src/lib/archive-utils.ts` | read-only | confirmed guarded | role checks, org/company guard |
| `src/lib/audit-server.ts` | mutation | needs manual review | .insert(, org/company guard |
| `src/lib/audit.ts` | mutation | needs manual review | .insert(, org/company guard |
| `src/lib/auth-bypass.ts` | read-only | confirmed guarded | none |
| `src/lib/brand.ts` | read-only | confirmed guarded | none |
| `src/lib/capabilities.ts` | mutation | dangerous unknown | .upsert( |
| `src/lib/checkout-link-server.ts` | elevated mutation | confirmed guarded | .insert(, .update(, createAdminClient, service role, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/lib/checkout-link.ts` | read-only | confirmed guarded | service role, role checks, org/company guard |
| `src/lib/client-interaction.ts` | read-only | confirmed guarded | none |
| `src/lib/client-notification-sound.ts` | read-only | confirmed guarded | none |
| `src/lib/command-center.ts` | read-only | confirmed guarded | none |
| `src/lib/coordinate-paste.ts` | read-only | confirmed guarded | none |
| `src/lib/finance-access.ts` | read-only | confirmed guarded | role checks, profile lookup |
| `src/lib/geofence.ts` | read-only | confirmed guarded | none |
| `src/lib/gps-consent.ts` | payroll/archive/GPS sensitive | needs manual review | .insert(, org/company guard |
| `src/lib/gps-freshness.ts` | read-only | confirmed guarded | none |
| `src/lib/gps-status.ts` | read-only | confirmed guarded | none |
| `src/lib/hooks/useGpsTracking.ts` | read-only | confirmed guarded | none |
| `src/lib/hooks/useVoice.ts` | read-only | confirmed guarded | none |
| `src/lib/i18n/context.tsx` | read-only | confirmed guarded | none |
| `src/lib/i18n/index.ts` | read-only | confirmed guarded | none |
| `src/lib/i18n/server.ts` | read-only | confirmed guarded | none |
| `src/lib/i18n/translations.ts` | read-only | confirmed guarded | service role, role checks, guard/assert helper |
| `src/lib/list-stability.ts` | read-only | confirmed guarded | none |
| `src/lib/live-map-utils.ts` | read-only | confirmed guarded | none |
| `src/lib/manager-data.ts` | read-only | confirmed guarded | role checks, profile lookup, guard/assert helper, org/company guard |
| `src/lib/manager-task-row-audit.ts` | read-only | confirmed guarded | none |
| `src/lib/manager-types.ts` | read-only | confirmed guarded | role checks |
| `src/lib/manager-utils.ts` | read-only | confirmed guarded | role checks, profile lookup, guard/assert helper |
| `src/lib/map-constants.ts` | read-only | confirmed guarded | role checks |
| `src/lib/material-driver-permissions.ts` | read-only | confirmed guarded | role checks, profile lookup |
| `src/lib/material-tasks.ts` | read-only | confirmed guarded | none |
| `src/lib/media-delete-permissions.ts` | read-only | confirmed guarded | role checks, profile lookup |
| `src/lib/media-extension.ts` | read-only | confirmed guarded | none |
| `src/lib/media-flags.ts` | storage/media mutation | dangerous unknown | .insert(, .update( |
| `src/lib/media-gallery.ts` | read-only | confirmed guarded | none |
| `src/lib/media-playback.ts` | read-only | confirmed guarded | none |
| `src/lib/message-state.ts` | read-only | confirmed guarded | none |
| `src/lib/message-types.ts` | read-only | confirmed guarded | none |
| `src/lib/mux-webhook.ts` | mutation | dangerous unknown | .update( |
| `src/lib/offline-time-events.ts` | read-only | confirmed guarded | org/company guard |
| `src/lib/offline-uploads.ts` | read-only | confirmed guarded | none |
| `src/lib/payroll-audit-utils.ts` | read-only | confirmed guarded | none |
| `src/lib/payroll-export-utils.ts` | read-only | confirmed guarded | none |
| `src/lib/payroll-period-utils.ts` | read-only | confirmed guarded | none |
| `src/lib/pin-login-rate-limit.ts` | team/auth sensitive | dangerous unknown | .update(, .upsert(, .delete( |
| `src/lib/preview-data.ts` | read-only | confirmed guarded | role checks, org/company guard |
| `src/lib/profile-skills.ts` | read-only | confirmed guarded | role checks, profile lookup |
| `src/lib/project-geocoding.ts` | read-only | confirmed guarded | none |
| `src/lib/project-navigation.ts` | read-only | confirmed guarded | none |
| `src/lib/project-planning-attachments.ts` | projects sensitive | needs manual review | .insert(, org/company guard |
| `src/lib/project-planning.ts` | read-only | confirmed guarded | none |
| `src/lib/project-save.ts` | projects sensitive | likely guarded | .insert(, .update(, guard/assert helper, org/company guard |
| `src/lib/project-schedule.ts` | read-only | confirmed guarded | none |
| `src/lib/role-permissions.ts` | read-only | confirmed guarded | role checks |
| `src/lib/roles.ts` | read-only | confirmed guarded | role checks |
| `src/lib/safe-log.ts` | read-only | confirmed guarded | role checks |
| `src/lib/safety-acknowledgements.ts` | mutation | needs manual review | .insert(, org/company guard |
| `src/lib/server/file-attachment-guard.ts` | read-only | confirmed guarded | guard/assert helper, org/company guard |
| `src/lib/server/id-guards.ts` | read-only | confirmed guarded | guard/assert helper |
| `src/lib/server/media-delete-permissions.ts` | read-only | confirmed guarded | profile lookup |
| `src/lib/server/media-delete.ts` | storage/media mutation | confirmed guarded | .update(, role checks, org/company guard |
| `src/lib/server/task-dispatch.ts` | tasks/messages sensitive | confirmed guarded | .insert(, role checks, profile lookup, guard/assert helper, org/company guard |
| `src/lib/shift-review.ts` | read-only | confirmed guarded | guard/assert helper |
| `src/lib/store-types.ts` | read-only | confirmed guarded | none |
| `src/lib/store-visits.ts` | mutation | dangerous unknown | .update(, .delete( |
| `src/lib/supabase/admin.ts` | read-only | confirmed guarded | createAdminClient, SUPABASE_SERVICE_ROLE_KEY |
| `src/lib/supabase/client.ts` | read-only | confirmed guarded | none |
| `src/lib/supabase/server.ts` | read-only | confirmed guarded | none |
| `src/lib/task-attachments.ts` | tasks/messages sensitive | likely guarded | .insert(, .update(, guard/assert helper, org/company guard |
| `src/lib/task-media-hydration.ts` | read-only | confirmed guarded | none |
| `src/lib/task-notifications.ts` | read-only | confirmed guarded | role checks |
| `src/lib/task-realtime.ts` | read-only | confirmed guarded | none |
| `src/lib/task-status.ts` | read-only | confirmed guarded | none |
| `src/lib/team-member-provisioning.ts` | read-only | confirmed guarded | none |
| `src/lib/upload-limits.ts` | read-only | confirmed guarded | none |
| `src/lib/voice-transcript.ts` | read-only | confirmed guarded | none |
| `src/lib/worker-clock-metadata.ts` | read-only | confirmed guarded | none |
| `src/lib/worker-data.ts` | mutation | needs manual review | .delete(, role checks, profile lookup |
| `src/lib/worker-hour-summary.ts` | read-only | confirmed guarded | none |
| `src/lib/worker-receipt-visibility.ts` | read-only | confirmed guarded | none |
| `src/lib/worker-task-ui.ts` | read-only | confirmed guarded | none |
| `src/lib/worker-types.ts` | read-only | confirmed guarded | profile lookup |
| `src/lib/worker-utils.ts` | read-only | confirmed guarded | none |
| `supabase/functions/detect-store-visit/index.ts` | elevated mutation | confirmed guarded | .insert(, .update(, .delete(, SUPABASE_SERVICE_ROLE_KEY, profile lookup, org/company guard |
