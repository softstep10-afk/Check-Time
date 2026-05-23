import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function listFiles() {
  const output = git(["ls-files"]);
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => {
      if (!/\.(ts|tsx|js|mjs)$/.test(file)) return false;
      return (
        file.startsWith("src/app/api/") ||
        (file.startsWith("src/app/") && file.endsWith("/route.ts")) ||
        file.startsWith("src/lib/server/") ||
        file.startsWith("src/lib/") ||
        file.startsWith("supabase/functions/")
      );
    });
}

function readText(file) {
  const fullPath = path.join(root, file);
  const stat = statSync(fullPath);
  if (stat.size > 2_000_000) return "";
  return readFileSync(fullPath, "utf8");
}

const detectors = [
  ["createAdminClient", /\bcreateAdminClient\b/],
  ["service role", /\bservice[_ -]?role\b/i],
  ["SUPABASE_SERVICE_ROLE_KEY", /\bSUPABASE_SERVICE_ROLE_KEY\b/],
  [".insert(", /\.insert\s*\(/],
  [".update(", /\.update\s*\(/],
  [".upsert(", /\.upsert\s*\(/],
  [".delete(", /\.delete\s*\(/],
  ["storage.from", /\bstorage\.from\s*\(/],
  ["remove(", /\.remove\s*\(/],
  ["rpc(", /\.rpc\s*\(/],
  ["auth.admin", /\bauth\.admin\b/],
  ["revalidatePath", /\brevalidatePath\b/],
  ["role checks", /\b(role|isOwnerAdminRole|can[A-Z][A-Za-z]+Role|canManage|canCreate|canUpdate)\b/],
  ["org/company guard", /\b(org_id|company_id|actor\.org_id|profile\.org_id|same-org|sameOrg)\b/i],
  ["profile lookup", /\.from\(["']profiles["']\)|requireManagerContext|getUser\(|auth\.getUser|profile:/],
  ["guard/assert helper", /\b(readRequiredUuid|readOptionalUuid|assert|guard|validate|require[A-Z][A-Za-z]+)\b/],
];

function category(file, evidence) {
  const text = `${file} ${evidence.join(" ")}`.toLowerCase();
  if (!evidence.some((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin|revalidatepath/i.test(item))) {
    return "read-only";
  }
  if (text.includes("auth") || text.includes("/team/") || text.includes("pin-login")) return "team/auth sensitive";
  if (text.includes("payroll") || text.includes("archive") || text.includes("trash") || text.includes("clock") || text.includes("gps") || text.includes("shift")) return "payroll/archive/GPS sensitive";
  if (text.includes("project")) return "projects sensitive";
  if (text.includes("task") || text.includes("message")) return "tasks/messages sensitive";
  if (text.includes("media") || text.includes("storage")) return "storage/media mutation";
  if (text.includes("createadminclient") || text.includes("service_role")) return "elevated mutation";
  return "mutation";
}

function risk(evidence) {
  const mutates = evidence.some((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin/i.test(item));
  const elevated = evidence.some((item) => /createAdminClient|service role|SUPABASE_SERVICE_ROLE_KEY|auth\.admin/i.test(item));
  const hasAuth = evidence.some((item) => /profile lookup|guard\/assert helper|role checks/i.test(item));
  const hasOrg = evidence.some((item) => /org\/company guard/i.test(item));
  if (!mutates) return "confirmed guarded";
  if (hasAuth && hasOrg && (elevated || evidence.includes("role checks"))) return "confirmed guarded";
  if (hasAuth && hasOrg) return "likely guarded";
  if (hasAuth || hasOrg) return "needs manual review";
  return "dangerous unknown";
}

const rows = listFiles().map((file) => {
  const text = readText(file);
  const evidence = detectors
    .filter(([, regex]) => regex.test(text))
    .map(([label]) => label);
  return {
    path: file,
    classification: category(file, evidence),
    mutationType: evidence.filter((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin|revalidatepath/i.test(item)),
    elevatedClientEvidence: evidence.filter((item) => /createAdminClient|service role|SUPABASE_SERVICE_ROLE_KEY|auth\.admin/i.test(item)),
    authProfileGuardEvidence: evidence.filter((item) => /profile lookup|role checks|guard\/assert helper/i.test(item)),
    orgResourceGuardEvidence: evidence.filter((item) => /org\/company guard/i.test(item)),
    riskLevel: risk(evidence),
  };
}).sort((a, b) => a.path.localeCompare(b.path));

mkdirSync(reportsDir, { recursive: true });
writeFileSync(
  path.join(reportsDir, "alpha7-route-mutation-guard-map.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);

const md = [
  "# Alpha-7 Route Mutation Guard Map",
  "",
  "Static local scan only. This report is not proof of vulnerability and does not call production.",
  "",
  "| Path | Classification | Risk | Evidence |",
  "| --- | --- | --- | --- |",
  ...rows.map((row) => `| \`${row.path}\` | ${row.classification} | ${row.riskLevel} | ${[
    ...row.mutationType,
    ...row.elevatedClientEvidence,
    ...row.authProfileGuardEvidence,
    ...row.orgResourceGuardEvidence,
  ].join(", ") || "none"} |`),
  "",
];
writeFileSync(path.join(reportsDir, "alpha7-route-mutation-guard-map.md"), md.join("\n"));

console.log("Alpha-7 route mutation guard map generated.");
console.log("reports/alpha7-route-mutation-guard-map.md");
console.log("reports/alpha7-route-mutation-guard-map.json");
