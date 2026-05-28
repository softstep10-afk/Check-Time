# Alpha-7 Route Mutation Map

Static local scan only. This report does not call production and does not claim a vulnerability by itself.

| Path | Classification | Dangerous zone | Risk | Evidence |
| --- | --- | --- | --- | --- |
| `src/app/api/ai/actions/create-project/route.ts` | project sensitive | yes | confirmed guarded | revalidatePath, createAdminClient, role checks, same-org guard helper, org/company guard |
| `src/app/api/ai/actions/create-task/route.ts` | task/message sensitive | yes | confirmed guarded | revalidatePath, createAdminClient, role checks, org/company guard |
| `src/app/api/ai/assistant/route.ts` | mutation | no | needs manual review | .update(, role checks, profile lookup |
| `src/app/api/ai/daily-report/route.ts` | mutation | no | needs manual review | .insert(, org/company guard |
| `src/app/api/ai/memory/route.ts` | mutation | no | dangerous unknown | .update( |
| `src/app/api/ai/photo-analysis/route.ts` | elevated mutation | no | confirmed guarded | .update(, createAdminClient, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/ai/realtime/connect/route.ts` | read-only | no | confirmed guarded | none |
| `src/app/api/ai/realtime/token/route.ts` | read-only | no | confirmed guarded | none |
| `src/app/api/ai/settings/route.ts` | mutation | no | needs manual review | .update(, role checks |
| `src/app/api/ai/voice-command/route.ts` | read-only | no | confirmed guarded | role checks |
| `src/app/api/ai/voice/route.ts` | mutation | no | needs manual review | .update(, role checks, profile lookup |
| `src/app/api/auth/pin-login/route.ts` | team/auth sensitive | no | needs manual review | auth.admin, createAdminClient, auth.admin, role checks, profile lookup |
| `src/app/api/manager/message-tasks/route.ts` | task/message sensitive | no | confirmed guarded | .update(, revalidatePath, createAdminClient, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/manager/projects/[id]/archive/route.ts` | payroll/archive/GPS sensitive | yes | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/manager/projects/[id]/planning/route.ts` | project sensitive | yes | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/manager/projects/[id]/route.ts` | project sensitive | yes | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/manager/projects/geocode/route.ts` | read-only | yes | confirmed guarded | profile lookup, same-org guard helper |
| `src/app/api/manager/projects/route.ts` | project sensitive | yes | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/manager/tasks/route.ts` | task/message sensitive | no | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/media/[id]/route.ts` | read-only | yes | confirmed guarded | createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/media/mux-webhook/route.ts` | storage/media mutation | no | confirmed guarded | .update(, createAdminClient, service role, role checks, org/company guard |
| `src/app/api/media/transcode/route.ts` | storage/media mutation | no | confirmed guarded | .update(, createAdminClient, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/payroll/export/route.ts` | read-only | yes | confirmed guarded | role checks, profile lookup, same-org guard helper |
| `src/app/api/payroll/run/route.ts` | payroll/archive/GPS sensitive | yes | confirmed guarded | .insert(, .update(, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/schedule/route.ts` | elevated mutation | no | confirmed guarded | .insert(, .update(, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/team/create/route.ts` | team/auth sensitive | yes | confirmed guarded | auth.admin, .insert(, createAdminClient, auth.admin, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/team/delete/route.ts` | team/auth sensitive | yes | confirmed guarded | auth.admin, .update(, createAdminClient, auth.admin, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/team/pay-worker/route.ts` | team/auth sensitive | yes | confirmed guarded | .insert(, .update(, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/team/reset-pin/route.ts` | team/auth sensitive | yes | confirmed guarded | .update(, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/team/update-profile/route.ts` | team/auth sensitive | yes | confirmed guarded | .update(, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/worker/claim-task/route.ts` | task/message sensitive | no | confirmed guarded | .update(, revalidatePath, createAdminClient, service role, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/worker/clock-out/route.ts` | payroll/archive/GPS sensitive | yes | confirmed guarded | .insert(, .update(, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/worker/jarvis/route.ts` | read-only | yes | confirmed guarded | none |
| `src/app/api/worker/link-checkin-video/route.ts` | read-only | no | confirmed guarded | createAdminClient, service role, role checks, profile lookup, same-org guard helper |
| `src/app/api/worker/link-checkout-video/route.ts` | read-only | no | confirmed guarded | createAdminClient, service role, role checks, profile lookup, same-org guard helper |
| `src/app/api/worker/project-tasks/route.ts` | project sensitive | no | confirmed guarded | revalidatePath, createAdminClient, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/app/api/worker/tasks/seen/route.ts` | task/message sensitive | no | confirmed guarded | .update(, revalidatePath, createAdminClient, role checks, profile lookup, org/company guard |
| `src/lib/ai/action-endpoints.ts` | read-only | no | confirmed guarded | none |
| `src/lib/ai/api-auth.ts` | read-only | no | confirmed guarded | profile lookup, same-org guard helper |
| `src/lib/ai/data.ts` | read-only | no | confirmed guarded | profile lookup |
| `src/lib/ai/google-tts.ts` | read-only | no | confirmed guarded | none |
| `src/lib/ai/jarvis-config.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/ai/jarvis-diagnostics.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/ai/jarvis-memory.ts` | read-only | yes | confirmed guarded | role checks, profile lookup |
| `src/lib/ai/jarvis-voice.ts` | read-only | yes | confirmed guarded | profile lookup |
| `src/lib/ai/prepared-action-audit.ts` | read-only | no | confirmed guarded | role checks, profile lookup, org/company guard |
| `src/lib/ai/provider-routing.ts` | read-only | no | confirmed guarded | none |
| `src/lib/ai/service.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/ai/types.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/ai/washington-code-knowledge.ts` | read-only | no | confirmed guarded | none |
| `src/lib/annual-report-utils.ts` | read-only | no | confirmed guarded | none |
| `src/lib/archive-utils.ts` | read-only | yes | confirmed guarded | role checks, org/company guard |
| `src/lib/audit-server.ts` | mutation | no | needs manual review | .insert(, org/company guard |
| `src/lib/audit.ts` | mutation | no | needs manual review | .insert(, org/company guard |
| `src/lib/auth-bypass.ts` | read-only | no | confirmed guarded | none |
| `src/lib/brand.ts` | read-only | no | confirmed guarded | none |
| `src/lib/capabilities.ts` | mutation | no | dangerous unknown | .upsert( |
| `src/lib/checkout-link-server.ts` | elevated mutation | no | confirmed guarded | .insert(, .update(, createAdminClient, service role, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/lib/checkout-link.ts` | read-only | no | confirmed guarded | service role, role checks, org/company guard |
| `src/lib/client-interaction.ts` | read-only | no | confirmed guarded | none |
| `src/lib/client-notification-sound.ts` | read-only | no | confirmed guarded | none |
| `src/lib/command-center.ts` | read-only | no | confirmed guarded | none |
| `src/lib/coordinate-paste.ts` | read-only | no | confirmed guarded | none |
| `src/lib/driver-time-projects.ts` | read-only | no | confirmed guarded | none |
| `src/lib/finance-access.ts` | read-only | no | confirmed guarded | role checks, profile lookup |
| `src/lib/geofence.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/gps-consent-ui.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/gps-consent.ts` | payroll/archive/GPS sensitive | yes | needs manual review | .insert(, org/company guard |
| `src/lib/gps-freshness.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/gps-status.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/hooks/useGpsTracking.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/hooks/useVoice.ts` | read-only | no | confirmed guarded | none |
| `src/lib/i18n/context.tsx` | read-only | no | confirmed guarded | none |
| `src/lib/i18n/index.ts` | read-only | no | confirmed guarded | none |
| `src/lib/i18n/server.ts` | read-only | no | confirmed guarded | none |
| `src/lib/i18n/translations.ts` | read-only | no | confirmed guarded | service role, role checks, same-org guard helper |
| `src/lib/list-stability.ts` | read-only | no | confirmed guarded | none |
| `src/lib/live-map-utils.ts` | read-only | no | confirmed guarded | none |
| `src/lib/manager-data.ts` | read-only | yes | confirmed guarded | role checks, profile lookup, same-org guard helper, org/company guard |
| `src/lib/manager-task-row-audit.ts` | read-only | no | confirmed guarded | none |
| `src/lib/manager-types.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/manager-utils.ts` | read-only | yes | confirmed guarded | role checks, profile lookup, same-org guard helper |
| `src/lib/map-constants.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/material-driver-permissions.ts` | read-only | no | confirmed guarded | role checks, profile lookup |
| `src/lib/material-spec-parser.ts` | read-only | no | confirmed guarded | none |
| `src/lib/material-tasks.ts` | read-only | no | confirmed guarded | none |
| `src/lib/media-delete-permissions.ts` | read-only | yes | confirmed guarded | role checks, profile lookup |
| `src/lib/media-extension.ts` | read-only | no | confirmed guarded | none |
| `src/lib/media-flags.ts` | storage/media mutation | no | dangerous unknown | .insert(, .update( |
| `src/lib/media-gallery.ts` | read-only | no | confirmed guarded | none |
| `src/lib/media-playback.ts` | read-only | no | confirmed guarded | none |
| `src/lib/message-state.ts` | read-only | no | confirmed guarded | none |
| `src/lib/message-types.ts` | read-only | no | confirmed guarded | none |
| `src/lib/mux-webhook.ts` | mutation | no | dangerous unknown | .update( |
| `src/lib/offline-field-actions.ts` | read-only | no | confirmed guarded | org/company guard |
| `src/lib/offline-time-events.ts` | read-only | no | confirmed guarded | org/company guard |
| `src/lib/offline-uploads.ts` | read-only | no | confirmed guarded | none |
| `src/lib/offline-visibility.ts` | read-only | no | confirmed guarded | none |
| `src/lib/payroll-audit-utils.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/payroll-export-utils.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/payroll-period-utils.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/pin-login-rate-limit.ts` | team/auth sensitive | no | dangerous unknown | .update(, .upsert(, .delete( |
| `src/lib/preview-data.ts` | read-only | no | confirmed guarded | role checks, org/company guard |
| `src/lib/profile-skills.ts` | read-only | no | confirmed guarded | role checks, profile lookup |
| `src/lib/project-geocoding.ts` | read-only | no | confirmed guarded | none |
| `src/lib/project-navigation.ts` | read-only | no | confirmed guarded | none |
| `src/lib/project-planning-attachments.ts` | project sensitive | no | needs manual review | .insert(, org/company guard |
| `src/lib/project-planning.ts` | read-only | no | confirmed guarded | none |
| `src/lib/project-save.ts` | project sensitive | no | likely guarded | .insert(, .update(, same-org guard helper, org/company guard |
| `src/lib/project-schedule.ts` | read-only | no | confirmed guarded | none |
| `src/lib/role-permissions.ts` | read-only | yes | confirmed guarded | role checks |
| `src/lib/roles.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/safe-log.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/safety-acknowledgements.ts` | mutation | no | needs manual review | .insert(, org/company guard |
| `src/lib/server/file-attachment-guard.ts` | read-only | no | confirmed guarded | same-org guard helper, org/company guard |
| `src/lib/server/id-guards.ts` | read-only | no | confirmed guarded | same-org guard helper |
| `src/lib/server/material-driver-config.ts` | read-only | no | confirmed guarded | none |
| `src/lib/server/media-delete-permissions.ts` | read-only | yes | confirmed guarded | profile lookup |
| `src/lib/server/media-delete.ts` | storage/media mutation | yes | confirmed guarded | .update(, role checks, org/company guard |
| `src/lib/server/task-dispatch.ts` | task/message sensitive | no | confirmed guarded | .insert(, role checks, profile lookup, same-org guard helper, org/company guard |
| `src/lib/shift-review.ts` | read-only | yes | confirmed guarded | same-org guard helper |
| `src/lib/store-types.ts` | read-only | no | confirmed guarded | none |
| `src/lib/store-visits.ts` | mutation | no | dangerous unknown | .update(, .delete( |
| `src/lib/supabase/admin.ts` | read-only | no | confirmed guarded | createAdminClient, SUPABASE_SERVICE_ROLE_KEY |
| `src/lib/supabase/client.ts` | read-only | no | confirmed guarded | none |
| `src/lib/supabase/server.ts` | read-only | no | confirmed guarded | none |
| `src/lib/task-attachments.ts` | task/message sensitive | no | likely guarded | .insert(, .update(, same-org guard helper, org/company guard |
| `src/lib/task-media-hydration.ts` | read-only | no | confirmed guarded | none |
| `src/lib/task-notifications.ts` | read-only | no | confirmed guarded | role checks |
| `src/lib/task-realtime.ts` | read-only | no | confirmed guarded | none |
| `src/lib/task-status.ts` | read-only | no | confirmed guarded | none |
| `src/lib/team-member-provisioning.ts` | read-only | no | confirmed guarded | none |
| `src/lib/upload-limits.ts` | read-only | no | confirmed guarded | none |
| `src/lib/voice-transcript.ts` | read-only | no | confirmed guarded | none |
| `src/lib/worker-clock-metadata.ts` | read-only | yes | confirmed guarded | none |
| `src/lib/worker-data.ts` | mutation | yes | needs manual review | .delete(, role checks, profile lookup |
| `src/lib/worker-hour-summary.ts` | read-only | no | confirmed guarded | none |
| `src/lib/worker-receipt-visibility.ts` | read-only | no | confirmed guarded | none |
| `src/lib/worker-task-ui.ts` | read-only | no | confirmed guarded | none |
| `src/lib/worker-types.ts` | read-only | no | confirmed guarded | profile lookup |
| `src/lib/worker-utils.ts` | read-only | no | confirmed guarded | none |
| `supabase/functions/detect-store-visit/index.ts` | mutation | yes | confirmed guarded | .insert(, .update(, .delete(, SUPABASE_SERVICE_ROLE_KEY, profile lookup, org/company guard |
