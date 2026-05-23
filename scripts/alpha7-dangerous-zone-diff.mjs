import { execFileSync } from "node:child_process";

const strict = process.argv.includes("--strict");

function git(args) {
  return execFileSync("git", args, { encoding: "utf8" });
}

function changedFiles() {
  const names = new Set();
  for (const args of [
    ["diff", "--name-only"],
    ["diff", "--cached", "--name-only"],
    ["status", "--short"],
  ]) {
    const output = git(args);
    for (const file of output.split(/\r?\n/).filter(Boolean)) {
      const statusPath = args[0] === "status" ? file.replace(/^.. /, "").trim() : file.trim();
      if (!statusPath) continue;
      names.add(statusPath.replace(/\\/g, "/"));
    }
  }
  return [...names].sort();
}

const zones = [
  { zone: "Supabase migrations", regex: /^supabase\/migrations\// },
  { zone: "Supabase functions", regex: /^supabase\/functions\// },
  { zone: "RLS / policy files", regex: /(rls|policy|policies)/i },
  { zone: "Storage policy files", regex: /(storage.*policy|policy.*storage|storage\/policies)/i },
  { zone: "Schema files", regex: /(schema|database|types\/database)/i },
  { zone: "Payroll / salary / paid periods", regex: /(payroll|salary|paid[-_ ]?period|closure)/i },
  { zone: "Shifts / clock / GPS", regex: /(shift|clock|gps|geofence|time[-_]?event)/i },
  { zone: "Archive / trash", regex: /(archive|trash|deleted_at|archived_at)/i },
  { zone: "Role hierarchy", regex: /(role-permissions|manager-utils|manager-data|worker-data|team\/|TeamPage|TeamMemberPage)/i },
  { zone: "Media delete permissions", regex: /(media-delete|delete-permissions|api\/media\/\[id\])/i },
  { zone: "Jarvis action permissions", regex: /(api\/ai\/actions|jarvis|ai\/assistant|ai\/voice)/i },
  { zone: "Project access guards", regex: /(project_access|project-access|project_assignments|project_exclusions|projects\/\[id\]|manager\/projects)/i },
];

const files = changedFiles();
const rows = files.map((file) => ({
  file,
  zones: zones.filter((zone) => zone.regex.test(file)).map((zone) => zone.zone),
}));
const dangerous = rows.filter((row) => row.zones.length > 0);

console.log("Alpha-7 dangerous zone diff");
console.log("Mode: read-only local git status/diff scan. No files were changed.");

if (files.length === 0) {
  console.log("No changed files detected.");
  process.exit(0);
}

for (const row of rows) {
  const label = row.zones.length > 0 ? row.zones.join(", ") : "not classified as dangerous";
  console.log(`${row.file} | ${label}`);
}

if (dangerous.length > 0) {
  console.log(`Danger/manual-review zones touched: ${dangerous.length}`);
  if (strict) process.exit(2);
}

process.exit(0);
