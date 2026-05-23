# Alpha-7 Invariant Gate

Static local regression gate. It does not call production, require secrets, or mutate app data.

| Result | Invariant | Evidence |
| --- | --- | --- |
| pass | material tasks use metadata/category/taskKind/materialRequest | src/lib/material-tasks.ts |
| pass | driver detection uses role driver or approved helper | src |
| pass | src business logic does not hardcode Sanya/Саня | src |
| pass | material dropdown does not fall back to whole team | ProjectDetailPage |
| pass | material task creation route validates driver assignee | src/app/api/manager/tasks/route.ts |
| pass | normal tasks/messages remain separate | task routes |
| pass | direct/private message history includes sender OR recipient | message-state |
| pass | message read status is handled separately from removal | message read path |
| pass | notification dismissal is signal-only around source records | notifications |
| pass | messages do not become tasks automatically in worker message history | worker messages |
| pass | read/taken/done lifecycle remains present | task lifecycle |
| pass | task visibility/realtime helpers remain present | tasks |
| pass | realtime merge/dedupe helper exists | src/lib/task-realtime.ts |
| pass | mobile Поехать / В путь action exists | project navigation UI |
| pass | Apple Maps helper exists | src/lib/project-navigation.ts |
| pass | Google Maps helper exists | src/lib/project-navigation.ts |
| pass | Tesla option remains share/copy only | ProjectNavigationActions |
| pass | no Tesla API/OAuth/token integration | project navigation |
| pass | copy address/location remains available | project navigation |
| pass | desktop top quick nav is hidden and mobile quick nav remains | manager layout |
| pass | desktop sidebar remains | manager layout |
| pass | high precision coordinates are accepted | coordinate inputs/tests |
| pass | coordinate inputs do not force step=0.000001 | src |
| pass | deadline edit flow includes start/end date fields | ProjectDetailPage |
| pass | PDF/Word/Excel/CSV/photo/video support remains | upload limits |
| pass | iPhone MOV/quicktime support remains | upload limits |
| pass | upload/open/download helpers exist | media helpers |
| pass | media delete permission helper exists | media delete permissions |
| pass | media delete stays restricted to Andrey/Sergey helper/config logic | media delete permissions |
| pass | upload/open/download is not blocked by media delete permission | src |
| pass | no new migration files created in this task | git diff |
| pass | no Storage policy files changed | git diff |
| pass | no RLS policy files changed | git diff |
| pass | 00099_wash_and_reset.sql remains detectable as local danger | supabase/migrations/00099_wash_and_reset.sql |
| pass | build/predeploy scripts do not run migrations or SQL | package.json |
