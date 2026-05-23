import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const failures = [];

function read(file) {
  return readFileSync(path.join(root, file), "utf8");
}

function pass(condition, label) {
  if (!condition) failures.push(label);
}

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" }).trim();
}

const srcFiles = git(["ls-files", "src"])
  .split(/\r?\n/)
  .filter(Boolean)
  .filter((file) => /\.(ts|tsx)$/.test(file));
const srcText = srcFiles.map((file) => read(file)).join("\n");

const materialRoute = read("src/app/api/manager/tasks/route.ts");
const projectDetail = read("src/components/manager/ProjectDetailPage.tsx");
const workerMessages = read("src/components/worker/WorkerMessagesPage.tsx");
const managerLayout = read("src/app/(manager)/layout.tsx");
const projectNavigation = read("src/components/shared/ProjectNavigationActions.tsx");
const projectNavigationLib = read("src/lib/project-navigation.ts");
const mediaDelete = read("src/lib/media-delete-permissions.ts");
const packageJson = read("package.json");

pass(!/\b(Sanya|Саня)\b/.test(srcText), "src business logic must not hardcode Sanya/Саня");
pass(materialRoute.includes("isMaterialDriverProfile"), "material creation route validates driver assignee");
pass(projectDetail.includes("filterMaterialDriverProfiles"), "material dropdown uses driver profile filter");
pass(!projectDetail.includes("Whole team / no driver"), "material dropdown must not use full-team fallback text");

pass(workerMessages.includes("buildPrivateMessageParticipantFilter"), "private messages load sender OR recipient history");
pass(workerMessages.includes("isPrivateMessageVisibleToProfile"), "private message visibility is not notification-only");

pass(managerLayout.includes('aria-label={t("nav.quick")}'), "manager quick nav exists");
pass(managerLayout.includes("md:hidden"), "manager quick nav is mobile-only");
pass(managerLayout.includes("app-sidebar"), "desktop sidebar remains present");

pass(projectNavigation.includes('t("projects.goMobile")'), "mobile Поехать action exists");
pass(projectNavigationLib.includes("buildAppleMapsDirectionsUrl"), "Apple Maps helper exists");
pass(projectNavigationLib.includes("buildGoogleMapsDirectionsUrl"), "Google Maps helper exists");
pass(projectNavigation.includes("shareForTesla"), "Tesla path is share/copy only");
pass(!/tesla.*(token|oauth|api)/i.test(projectNavigation + projectNavigationLib), "no Tesla API/OAuth/token path");

pass(!/step=["']0\.000001["']/.test(srcText), "coordinate inputs must not force step=0.000001");
pass(srcText.includes("inputMode=\"decimal\"") || srcText.includes("inputMode: \"decimal\""), "high precision coordinate text/decimal input support present");

pass(mediaDelete.includes("canDeleteMediaEverywhere"), "media delete privilege helper exists");
pass(/andrey|andrei|андрей/i.test(mediaDelete) && /sergey|sergei|сергей/i.test(mediaDelete), "media delete remains Andrey/Sergey-specific");
pass(!mediaDelete.includes("isOwnerAdminRole"), "media delete is not broad owner/admin permission");

pass(existsSync(path.join(root, "supabase/migrations/00099_wash_and_reset.sql")), "known reset migration remains detectable");
pass(!/"(build|alpha7:predeploy)"\s*:\s*"[^"]*(migration|supabase db push|psql)/i.test(packageJson), "build/predeploy must not execute migrations");

const changed = new Set(
  [
    ...git(["diff", "--name-only"]).split(/\r?\n/),
    ...git(["diff", "--cached", "--name-only"]).split(/\r?\n/),
  ].filter(Boolean),
);
pass(![...changed].some((file) => /^supabase\/migrations\/(?!00099_wash_and_reset\.sql)/.test(file)), "no new migration files changed");
pass(![...changed].some((file) => /storage.*policy|policy.*storage/i.test(file)), "no Storage policy files changed");
pass(![...changed].some((file) => /(rls|policy|policies)/i.test(file) && file.startsWith("supabase/")), "no Supabase RLS/policy files changed");

console.log("Alpha-7 RC safety gate");
console.log("Mode: local static source checks only. No production calls or mutations.");

if (failures.length > 0) {
  for (const failure of failures) console.log(`[fail] ${failure}`);
  process.exit(2);
}

console.log("All RC safety gate checks passed.");
