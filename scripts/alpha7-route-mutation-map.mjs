import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function listFiles() {
  return git(["ls-files"])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => /\.(ts|tsx|js|mjs)$/.test(file))
    .filter(
      (file) =>
        file.startsWith("src/app/api/") ||
        (file.startsWith("src/app/") && file.endsWith("/route.ts")) ||
        file.startsWith("src/lib/server/") ||
        file.startsWith("src/lib/") ||
        file.startsWith("supabase/functions/"),
    );
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
  ["auth.admin", /\bauth\.admin\b/],
  [".insert(", /\.insert\s*\(/],
  [".update(", /\.update\s*\(/],
  [".upsert(", /\.upsert\s*\(/],
  [".delete(", /\.delete\s*\(/],
  [".rpc(", /\.rpc\s*\(/],
  ["storage.from", /\bstorage\.from\s*\(/],
  ["remove(", /\.remove\s*\(/],
  ["revalidatePath", /\brevalidatePath\b/],
  ["role checks", /\b(role|isOwnerAdminRole|can[A-Z][A-Za-z]+Role|canManage|canCreate|canUpdate)\b/],
  ["org/company guard", /\b(org_id|company_id|actor\.org_id|profile\.org_id|same-org|sameOrg)\b/i],
  ["profile lookup", /\.from\(["']profiles["']\)|requireManagerContext|getUser\(|auth\.getUser|profile:/],
  ["same-org guard helper", /\b(readRequiredUuid|readOptionalUuid|assert|guard|validate|require[A-Z][A-Za-z]+)\b/],
];

const dangerousZones = [
  /^supabase\/migrations\//,
  /^supabase\/functions\//,
  /(rls|policy|policies)/i,
  /(storage.*policy|policy.*storage|storage\/policies)/i,
  /(schema|types\/database)/i,
  /(payroll|salary|paid[-_ ]?period|archive|trash|clock|gps|geofence|shift)/i,
  /(role-permissions|manager-utils|manager-data|worker-data|team\/|TeamPage|TeamMemberPage)/i,
  /(media-delete|api\/media\/\[id\])/i,
  /(api\/ai\/actions|jarvis)/i,
  /(projects\/\[id\]|manager\/projects|project_access|project-access)/i,
];

function classification(file, evidence) {
  const text = `${file} ${evidence.join(" ")}`.toLowerCase();
  const mutates = evidence.some((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin|revalidatepath/i.test(item));
  if (!mutates) return "read-only";
  if (text.includes("auth") || text.includes("/team/") || text.includes("pin-login")) return "team/auth sensitive";
  if (text.includes("payroll") || text.includes("archive") || text.includes("trash") || text.includes("clock") || text.includes("gps") || text.includes("shift")) return "payroll/archive/GPS sensitive";
  if (text.includes("project")) return "project sensitive";
  if (text.includes("task") || text.includes("message")) return "task/message sensitive";
  if (text.includes("media") || text.includes("storage")) return "storage/media mutation";
  if (text.includes("createadminclient") || text.includes("service role")) return "elevated mutation";
  return "mutation";
}

function risk(evidence) {
  const mutates = evidence.some((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin/i.test(item));
  const elevated = evidence.some((item) => /createAdminClient|service role|SUPABASE_SERVICE_ROLE_KEY|auth\.admin/i.test(item));
  const hasAuth = evidence.some((item) => /profile lookup|role checks|same-org guard helper/i.test(item));
  const hasOrg = evidence.some((item) => /org\/company guard/i.test(item));
  if (!mutates) return "confirmed guarded";
  if (hasAuth && hasOrg && (elevated || evidence.includes("role checks"))) return "confirmed guarded";
  if (hasAuth && hasOrg) return "likely guarded";
  if (hasAuth || hasOrg) return "needs manual review";
  return "dangerous unknown";
}

const rows = listFiles()
  .map((file) => {
    const text = readText(file);
    const evidence = detectors.filter(([, regex]) => regex.test(text)).map(([label]) => label);
    return {
      path: file,
      classification: classification(file, evidence),
      mutationEvidence: evidence.filter((item) => /insert|update|upsert|delete|remove|rpc|auth\.admin|revalidatepath/i.test(item)),
      elevatedClientEvidence: evidence.filter((item) => /createAdminClient|service role|SUPABASE_SERVICE_ROLE_KEY|auth\.admin/i.test(item)),
      authProfileGuardEvidence: evidence.filter((item) => /profile lookup|role checks|same-org guard helper/i.test(item)),
      orgResourceGuardEvidence: evidence.filter((item) => /org\/company guard/i.test(item)),
      dangerousZone: dangerousZones.some((regex) => regex.test(file)),
      risk: risk(evidence),
    };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

mkdirSync(reportsDir, { recursive: true });
writeFileSync(
  path.join(reportsDir, "alpha7-route-mutation-map.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);

const md = [
  "# Alpha-7 Route Mutation Map",
  "",
  "Static local scan only. This report does not call production and does not claim a vulnerability by itself.",
  "",
  "| Path | Classification | Dangerous zone | Risk | Evidence |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map((row) => {
    const evidence = [
      ...row.mutationEvidence,
      ...row.elevatedClientEvidence,
      ...row.authProfileGuardEvidence,
      ...row.orgResourceGuardEvidence,
    ].join(", ") || "none";
    return `| \`${row.path}\` | ${row.classification} | ${row.dangerousZone ? "yes" : "no"} | ${row.risk} | ${evidence} |`;
  }),
  "",
];
writeFileSync(path.join(reportsDir, "alpha7-route-mutation-map.md"), md.join("\n"));

console.log("Alpha-7 route mutation map generated.");
console.log("reports/alpha7-route-mutation-map.md");
console.log("reports/alpha7-route-mutation-map.json");
