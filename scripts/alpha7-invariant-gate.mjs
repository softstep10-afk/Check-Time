import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");
const checks = [];

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

function trackedFiles(prefixes, extensions) {
  return git(["ls-files"])
    .split(/\r?\n/)
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => prefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => extensions.some((extension) => file.endsWith(extension)));
}

function safeRead(file) {
  const fullPath = path.join(root, file);
  if (!existsSync(fullPath)) return "";
  const stat = statSync(fullPath);
  if (stat.size > 2_000_000) return "";
  return readFileSync(fullPath, "utf8");
}

function add(ok, label, evidence = "") {
  checks.push({ ok: Boolean(ok), label, evidence });
}

const srcFiles = trackedFiles(["src/"], [".ts", ".tsx"]);
const srcText = srcFiles.map(safeRead).join("\n");
const packageJson = safeRead("package.json");
const materialTasks = safeRead("src/lib/material-tasks.ts");
const materialRoute = safeRead("src/app/api/manager/tasks/route.ts");
const projectDetail = safeRead("src/components/manager/ProjectDetailPage.tsx");
const workerData = safeRead("src/lib/worker-data.ts");
const workerMessages = safeRead("src/components/worker/WorkerMessagesPage.tsx");
const messageState = safeRead("src/lib/message-state.ts");
const taskRealtime = safeRead("src/lib/task-realtime.ts");
const taskNotifications = safeRead("src/lib/task-notifications.ts");
const managerLayout = safeRead("src/app/(manager)/layout.tsx");
const projectNavigation = safeRead("src/components/shared/ProjectNavigationActions.tsx");
const projectNavigationLib = safeRead("src/lib/project-navigation.ts");
const uploadLimits = safeRead("src/lib/upload-limits.ts");
const mediaDelete = safeRead("src/lib/media-delete-permissions.ts");

add(/taskKind|materialRequest|category/.test(materialTasks), "material tasks use metadata/category/taskKind/materialRequest", "src/lib/material-tasks.ts");
add(/role\s*===\s*["']driver["']|isMaterialDriverProfile|filterMaterialDriverProfiles|filterMaterialTakerProfiles/.test(srcText), "driver detection uses role driver or approved helper", "src");
add(!/\b(Sanya|Саня)\b/.test(srcText), "src business logic does not hardcode Sanya/Саня", "src");
add(!/Whole team \/ no driver|Вся команда \/ без водителя/.test(projectDetail), "material dropdown does not fall back to whole team", "ProjectDetailPage");
add(/isEligibleMaterialTaker/.test(materialRoute), "material task creation route validates selected field assignee", "src/app/api/manager/tasks/route.ts");
add(!/Choose a driver for the material task/.test(materialRoute), "material task creation allows open shared queue", "src/app/api/manager/tasks/route.ts");
add(/createManagerTask/.test(materialRoute) && /messages|message-tasks/.test(srcText), "normal tasks/messages remain separate", "task routes");

add(/sender_id|recipient_id|buildPrivateMessageParticipantFilter/.test(messageState + workerMessages), "direct/private message history includes sender OR recipient", "message-state");
add(/markMessagesReadById|\.update\(\{\s*read:\s*true\s*\}\)|read_at|readStatus/i.test(workerMessages + messageState), "message read status is handled separately from removal", "message read path");
add(/notification|dismiss|clear/i.test(srcText) && /source.*message|source.*task|task_id|message_id/i.test(srcText), "notification dismissal is signal-only around source records", "notifications");
add(!/createManagerTask\([^)]*message/i.test(workerMessages), "messages do not become tasks automatically in worker message history", "worker messages");

add(/read|taken|done/.test(taskNotifications + workerData + projectDetail), "read/taken/done lifecycle remains present", "task lifecycle");
add(/task remains|visible|mergeRealtimeTaskRow|filter\(isMaterialTask\)/i.test(taskNotifications + workerData + projectDetail + taskRealtime), "task visibility/realtime helpers remain present", "tasks");
add(/mergeRealtimeTaskRow/.test(taskRealtime + workerData + projectDetail), "realtime merge/dedupe helper exists", "src/lib/task-realtime.ts");

add(/projects\.goMobile|В путь|Поехать/.test(projectNavigation + projectDetail), "mobile Поехать / В путь action exists", "project navigation UI");
add(/buildAppleMapsDirectionsUrl/.test(projectNavigationLib), "Apple Maps helper exists", "src/lib/project-navigation.ts");
add(/buildGoogleMapsDirectionsUrl/.test(projectNavigationLib), "Google Maps helper exists", "src/lib/project-navigation.ts");
add(/shareForTesla|copy/.test(projectNavigation), "Tesla option remains share/copy only", "ProjectNavigationActions");
add(!/tesla.*(token|oauth|api)/i.test(projectNavigation + projectNavigationLib), "no Tesla API/OAuth/token integration", "project navigation");
add(/copy/.test(projectNavigation + projectNavigationLib), "copy address/location remains available", "project navigation");

add(/aria-label={t\("nav\.quick"\)}/.test(managerLayout) && /md:hidden/.test(managerLayout), "desktop top quick nav is hidden and mobile quick nav remains", "manager layout");
add(/app-sidebar/.test(managerLayout), "desktop sidebar remains", "manager layout");

add(/inputMode="decimal"|inputMode:\s*"decimal"|coordinate paste|high precision/i.test(srcText), "high precision coordinates are accepted", "coordinate inputs/tests");
add(!/step=["']0\.000001["']/.test(srcText), "coordinate inputs do not force step=0.000001", "src");
add(/start_date|end_date|deadline/i.test(projectDetail), "deadline edit flow includes start/end date fields", "ProjectDetailPage");

add(/application\/pdf|\.docx|\.xlsx|\.csv|video\/quicktime/.test(uploadLimits + srcText), "PDF/Word/Excel/CSV/photo/video support remains", "upload limits");
add(/video\/quicktime|\.mov/.test(uploadLimits + srcText), "iPhone MOV/quicktime support remains", "upload limits");
add(/signedUrl|open\/download|download|storage_path/i.test(srcText), "upload/open/download helpers exist", "media helpers");
add(/canDeleteMediaEverywhere/.test(mediaDelete), "media delete permission helper exists", "media delete permissions");
add(/andrey|andrei|андрей/i.test(mediaDelete) && /sergey|sergei|сергей/i.test(mediaDelete), "media delete stays restricted to Andrey/Sergey helper/config logic", "media delete permissions");
add(!/canDeleteMediaEverywhere[\s\S]{0,400}(upload|download|open)/i.test(srcText), "upload/open/download is not blocked by media delete permission", "src");

const changedFiles = new Set([
  ...git(["diff", "--name-only"]).split(/\r?\n/).filter(Boolean),
  ...git(["diff", "--cached", "--name-only"]).split(/\r?\n/).filter(Boolean),
]);
add(![...changedFiles].some((file) => /^supabase\/migrations\/(?!00099_wash_and_reset\.sql)/.test(file)), "no new migration files created in this task", "git diff");
add(![...changedFiles].some((file) => /storage.*policy|policy.*storage/i.test(file)), "no Storage policy files changed", "git diff");
add(![...changedFiles].some((file) => /(rls|policy|policies)/i.test(file) && file.startsWith("supabase/")), "no RLS policy files changed", "git diff");
add(existsSync(path.join(root, "supabase/migrations/00099_wash_and_reset.sql")), "00099_wash_and_reset.sql remains detectable as local danger", "supabase/migrations/00099_wash_and_reset.sql");
add(!/"(build|alpha7:predeploy)"\s*:\s*"[^"]*(migration|supabase db push|psql)/i.test(packageJson), "build/predeploy scripts do not run migrations or SQL", "package.json");

const failed = checks.filter((check) => !check.ok);
mkdirSync(reportsDir, { recursive: true });
writeFileSync(
  path.join(reportsDir, "alpha7-invariant-gate.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), passed: failed.length === 0, checks }, null, 2)}\n`,
);
writeFileSync(
  path.join(reportsDir, "alpha7-invariant-gate.md"),
  [
    "# Alpha-7 Invariant Gate",
    "",
    "Static local regression gate. It does not call production, require secrets, or mutate app data.",
    "",
    "| Result | Invariant | Evidence |",
    "| --- | --- | --- |",
    ...checks.map((check) => `| ${check.ok ? "pass" : "fail"} | ${check.label} | ${check.evidence} |`),
    "",
  ].join("\n"),
);

console.log("Alpha-7 invariant gate");
console.log("Mode: local static source checks only. No production calls or data mutations.");
console.log("reports/alpha7-invariant-gate.md");
console.log("reports/alpha7-invariant-gate.json");

if (failed.length > 0) {
  for (const check of failed) console.log(`[fail] ${check.label}`);
  process.exit(2);
}

console.log("All invariant checks passed.");
