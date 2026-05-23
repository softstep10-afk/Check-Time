import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const reportsDir = path.join(root, "reports");

function git(args) {
  return execFileSync("git", args, { cwd: root, encoding: "utf8" });
}

function listFiles(prefixes, extensions) {
  return git(["ls-files"])
    .split(/\r?\n/)
    .map((file) => file.trim())
    .filter(Boolean)
    .map((file) => file.replace(/\\/g, "/"))
    .filter((file) => prefixes.some((prefix) => file.startsWith(prefix)))
    .filter((file) => extensions.some((extension) => file.endsWith(extension)));
}

function readText(file) {
  const stat = statSync(path.join(root, file));
  if (stat.size > 2_000_000) return "";
  return readFileSync(path.join(root, file), "utf8");
}

const testFiles = listFiles(["tests/"], [".test.ts", ".test.tsx"]);
const sourceFiles = listFiles(["src/"], [".ts", ".tsx"]);
const docFiles = listFiles(["docs/"], [".md"]);
const all = [...testFiles, ...sourceFiles, ...docFiles].map((file) => ({
  file,
  text: readText(file).toLowerCase(),
}));

const categories = [
  ["material driver-only dropdown", [/filterMaterialDriverProfiles|driver-only|material driver|isMaterialDriverProfile/i]],
  ["material task server validation", [/isMaterialDriverProfile|materialEnabled|manager\/tasks|material task.*reject/i]],
  ["driver role filtering", [/role\s*===\s*["']driver["']|shouldFilterWorkerTasksToMaterials|isMaterialDriverProfile/i]],
  ["private message sender/recipient persistence", [/sender_id|recipient_id|sender-or-recipient|isPrivateMessageVisibleToProfile|buildPrivateMessageParticipantFilter/i]],
  ["task read/taken/done visibility", [/read\/taken\/done|task remains|taken.*done|mergeRealtimeTaskRow|task-notifications/i]],
  ["notification-as-signal", [/notification|source message|source task|bell count|notification clear|notification-as-signal/i]],
  ["mobile Поехать preference", [/Поехать|projectNavigationPreferredApp|goMobile|navigation preference/i]],
  ["project navigation Apple/Google/Tesla/copy", [/Apple Maps|Google Maps|Tesla|buildAppleMapsDirectionsUrl|buildGoogleMapsDirectionsUrl|copy address/i]],
  ["deadline editing", [/deadline|end_date|project-deadline-edit/i]],
  ["high precision coordinates", [/high precision|coordinate paste|47\.307322|allow high precision|project-coordinate-inputs|inputmode="decimal"/i]],
  ["quick nav mobile-only", [/quick navigation|nav\.quick|md:hidden|sidebar/i]],
  ["supervisor worker-like access", [/supervisor.*worker|manager-tier|isManagerRole/i]],
  ["media delete only Andrey/Sergey", [/Andrey|Sergey|media delete|canDeleteMediaEverywhere|media-delete-permissions/i]],
  ["file upload/open/download", [/upload.*download|signedUrl|open\/download|task-attachments-upload|upload-limits|video\/quicktime/i]],
  ["Jarvis confirmation and real id success", [/Jarvis.*confirmation|success.*id|created.*id|create_project|create_task/i]],
  ["archive/trash separation", [/archive.*trash|trash.*archive|archive-utils|ARCHIVE_TRASH_AUDIT/i]],
  ["payroll untouched", [/payroll.*audit|PAYROLL_ARCHIVE_AUDIT|payroll-export-utils|payroll-period-utils/i]],
  ["GPS/shift untouched", [/gps|geofence|shift|clock-in|clock-out|worker-clock/i]],
];

function matches(entry, patterns) {
  return patterns.some((pattern) => pattern.test(entry.file) || pattern.test(entry.text));
}

const rows = categories.map(([category, patterns]) => {
  const tests = all.filter((entry) => entry.file.startsWith("tests/") && matches(entry, patterns)).map((entry) => entry.file);
  const sources = all.filter((entry) => entry.file.startsWith("src/") && matches(entry, patterns)).map((entry) => entry.file);
  const docs = all.filter((entry) => entry.file.startsWith("docs/") && matches(entry, patterns)).map((entry) => entry.file);
  const coverageLevel =
    tests.length > 0 && sources.length > 0
      ? "covered"
      : tests.length > 0 || (sources.length > 0 && docs.length > 0)
        ? "partial"
        : sources.length > 0
          ? "source-only"
          : docs.length > 0
            ? "docs-only"
            : "missing";
  return {
    category,
    testsFound: [...new Set(tests)].sort(),
    sourceFilesFound: [...new Set(sources)].sort(),
    docsFound: [...new Set(docs)].sort(),
    coverageLevel,
    recommendedFutureTest:
      coverageLevel === "covered"
        ? ""
        : `Add focused regression coverage for ${category}.`,
  };
});

mkdirSync(reportsDir, { recursive: true });
writeFileSync(
  path.join(reportsDir, "alpha7-coverage-map.json"),
  `${JSON.stringify({ generatedAt: new Date().toISOString(), rows }, null, 2)}\n`,
);

const md = [
  "# Alpha-7 Coverage Map",
  "",
  "Static local scan of tests, source, and docs for critical Alpha-7 invariants.",
  "",
  "| Category | Coverage | Tests | Source | Recommendation |",
  "| --- | --- | --- | --- | --- |",
  ...rows.map((row) => `| ${row.category} | ${row.coverageLevel} | ${row.testsFound.length} | ${row.sourceFilesFound.length} | ${row.recommendedFutureTest || "None"} |`),
  "",
];
writeFileSync(path.join(reportsDir, "alpha7-coverage-map.md"), md.join("\n"));

console.log("Alpha-7 coverage map generated.");
console.log("reports/alpha7-coverage-map.md");
console.log("reports/alpha7-coverage-map.json");
