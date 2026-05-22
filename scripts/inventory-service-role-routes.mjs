import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();

const patterns = [
  { label: "createAdminClient", regex: /\bcreateAdminClient\b/g },
  { label: "SUPABASE_SERVICE_ROLE_KEY", regex: /\bSUPABASE_SERVICE_ROLE_KEY\b/g },
  { label: "auth.admin", regex: /\bauth\.admin\b/g },
  { label: "supabaseAdmin", regex: /\bsupabaseAdmin\b/g },
  { label: "adminClient", regex: /\badminClient\b/g },
  { label: "createServiceRole", regex: /\bcreateServiceRole\b/g },
];

function listRepoFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => {
      const normalized = file.replace(/\\/g, "/");
      if (normalized === "scripts/inventory-service-role-routes.mjs") return false;
      if (normalized === "scripts/check-dangerous-files.mjs") return false;
      if (normalized === "src/lib/i18n/translations.ts") return false;
      return (
        normalized.startsWith("src/app/api/") ||
        normalized.startsWith("src/lib/") ||
        normalized.startsWith("supabase/functions/") ||
        normalized.startsWith("scripts/")
      );
    });
}

function readTextFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  const stat = statSync(fullPath);
  if (stat.size > 2_000_000) return null;
  const buffer = readFileSync(fullPath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function categoryFor(file) {
  const normalized = file.replace(/\\/g, "/");
  if (normalized.includes("/api/team/") || normalized.includes("/api/auth/")) return "team/auth";
  if (normalized.includes("/api/manager/projects/")) return "projects";
  if (normalized.includes("/api/manager/tasks") || normalized.includes("/api/worker/claim-task") || normalized.includes("/api/worker/project-tasks") || normalized.includes("/api/worker/tasks/")) return "tasks";
  if (normalized.includes("message")) return "messages";
  if (normalized.includes("/api/media/") || normalized.includes("checkout-link") || normalized.includes("storage")) return "files/storage";
  if (normalized.includes("/api/ai/") || normalized.includes("/ai/")) return "Jarvis/AI";
  if (normalized.includes("payroll")) return "payroll";
  if (normalized.includes("/api/schedule")) return "schedule";
  if (normalized.includes("/api/worker/clock") || normalized.includes("clock")) return "worker clock/shifts";
  if (normalized.startsWith("supabase/functions/")) return "edge function";
  if (normalized.startsWith("scripts/")) return "local script";
  if (normalized.startsWith("src/lib/")) return "shared helper";
  return "unknown";
}

const rows = [];

for (const file of listRepoFiles()) {
  const normalized = file.replace(/\\/g, "/");
  const text = readTextFile(normalized);
  if (text === null) continue;

  const matches = [];
  for (const pattern of patterns) {
    if (pattern.regex.test(text)) matches.push(pattern.label);
    pattern.regex.lastIndex = 0;
  }

  if (matches.length > 0) {
    rows.push({
      file: normalized,
      category: categoryFor(normalized),
      matches: [...new Set(matches)].sort(),
    });
  }
}

console.log("Alpha-7 service-role inventory");
console.log("Mode: read-only static inventory. This is not proof of vulnerability.");

if (rows.length === 0) {
  console.log("No elevated Supabase patterns found.");
  process.exit(0);
}

for (const row of rows.sort((a, b) => a.file.localeCompare(b.file))) {
  console.log(`${row.category} | ${row.file} | ${row.matches.join(", ")}`);
}

console.log("Reminder: fixing any permission concern requires a separate owner-approved task.");
