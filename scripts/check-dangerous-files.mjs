import { execFileSync } from "node:child_process";
import { readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const knownLocalResetFile = "supabase/migrations/00099_wash_and_reset.sql";

function listRepoFiles() {
  const output = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard"], {
    cwd: root,
    encoding: "utf8",
  });
  return output
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .filter((file) => !file.startsWith(".git/"))
    .filter((file) => !file.startsWith("node_modules/"))
    .filter((file) => !file.startsWith(".next/"))
    .filter((file) => !file.startsWith("out/"))
    .filter((file) => !file.startsWith("coverage/"));
}

function readTextFile(relativePath) {
  const fullPath = path.join(root, relativePath);
  const stat = statSync(fullPath);
  if (stat.size > 2_000_000) return null;
  const buffer = readFileSync(fullPath);
  if (buffer.includes(0)) return null;
  return buffer.toString("utf8");
}

function countMatches(text, regex) {
  return [...text.matchAll(regex)].length;
}

const sqlPatterns = [
  { label: "truncate", regex: /\btruncate\b/gi },
  { label: "drop schema", regex: /\bdrop\s+schema\b/gi },
  { label: "drop table", regex: /\bdrop\s+table\b/gi },
  { label: "delete from", regex: /\bdelete\s+from\b/gi },
  { label: "alter policy", regex: /\balter\s+policy\b/gi },
  { label: "create policy", regex: /\bcreate\s+policy\b/gi },
  { label: "storage.objects", regex: /\bstorage\.objects\b/gi },
  { label: "grant", regex: /\bgrant\b/gi },
  { label: "revoke", regex: /\brevoke\b/gi },
];

const secretAssignmentPatterns = [
  {
    label: "SUPABASE_SERVICE_ROLE_KEY assignment",
    regex: /\bSUPABASE_SERVICE_ROLE_KEY\s*=\s*['"]?(?:eyJ|sb_secret|[A-Za-z0-9._-]{40,})/g,
  },
  {
    label: "DATABASE_URL assignment",
    regex: /\bDATABASE_URL\s*=\s*['"]?(?:postgres|postgresql):\/\//g,
  },
  {
    label: "POSTGRES_URL assignment",
    regex: /\bPOSTGRES_URL\s*=\s*['"]?(?:postgres|postgresql):\/\//g,
  },
  {
    label: "SUPABASE_DB_URL assignment",
    regex: /\bSUPABASE_DB_URL\s*=\s*['"]?(?:postgres|postgresql):\/\//g,
  },
];

const findings = [];
const blockers = [];

for (const file of listRepoFiles()) {
  const normalized = file.replace(/\\/g, "/");
  const lower = normalized.toLowerCase();
  const extension = path.extname(normalized).toLowerCase();

  if (
    [".sql", ".sh", ".ps1", ".bat", ".cmd", ".mjs", ".js", ".ts"].includes(extension) &&
    (lower.includes("wash") || lower.includes("reset")) &&
    lower.includes("migration")
  ) {
    findings.push({
      severity: normalized === knownLocalResetFile ? "known-local-danger" : "review",
      file: normalized,
      detail: "filename contains wash/reset in migration-related path",
    });
  }

  const text = readTextFile(normalized);
  if (text === null) continue;

  for (const pattern of secretAssignmentPatterns) {
    if (pattern.regex.test(text)) {
      blockers.push({
        severity: "blocker",
        file: normalized,
        detail: `${pattern.label} detected; value redacted`,
      });
    }
    pattern.regex.lastIndex = 0;
  }

  const isClientSourceFile =
    normalized.startsWith("src/") &&
    [".ts", ".tsx", ".js", ".jsx"].includes(extension) &&
    /^\s*["']use client["'];?/m.test(text);

  if (text.includes("SUPABASE_SERVICE_ROLE_KEY") && isClientSourceFile) {
    blockers.push({
      severity: "blocker",
      file: normalized,
      detail: "service-role env name appears in a client component; value redacted",
    });
  }

  if (extension === ".sql") {
    const details = [];
    for (const pattern of sqlPatterns) {
      const count = countMatches(text, pattern.regex);
      if (count > 0) details.push(`${pattern.label} x${count}`);
    }
    if (details.length > 0) {
      findings.push({
        severity: normalized === knownLocalResetFile ? "known-local-danger" : "review",
        file: normalized,
        detail: details.join(", "),
      });
    }
  }
}

console.log("Alpha-7 dangerous file scan");
console.log("Mode: read-only static scan. No files were changed.");

if (findings.length === 0 && blockers.length === 0) {
  console.log("No dangerous file patterns found.");
  process.exit(0);
}

for (const finding of findings) {
  console.log(`[${finding.severity}] ${finding.file}: ${finding.detail}`);
}

for (const blocker of blockers) {
  console.log(`[${blocker.severity}] ${blocker.file}: ${blocker.detail}`);
}

if (findings.some((finding) => finding.file === knownLocalResetFile)) {
  console.log(`Known local reset file present: ${knownLocalResetFile}`);
  console.log("Do not delete or execute it without explicit owner approval.");
}

if (blockers.length > 0) {
  console.log("High-confidence secret/client-service-role blocker found.");
  process.exit(2);
}

console.log("No high-confidence committed secret leaks found.");
process.exit(0);
