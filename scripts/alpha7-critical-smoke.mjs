#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const requiredDocs = [
  "docs/REGRESSION_IMPACT_RULES_ALPHA7.md",
  "docs/CRITICAL_PATH_SMOKE_ALPHA7.md",
  "docs/DANGEROUS_ZONES_ALPHA7.md",
];

for (const path of requiredDocs) {
  readFileSync(resolve(process.cwd(), path), "utf8");
}

const smoke = readFileSync(
  resolve(process.cwd(), "docs/CRITICAL_PATH_SMOKE_ALPHA7.md"),
  "utf8",
);

const requiredPhrases = [
  "Login works",
  "Open project",
  "`Поехать`",
  "Copy address",
  "Start shift",
  "Finish shift",
  "Create normal task",
  "Take task",
  "Complete task",
  "Material queue",
  "Send private/direct message",
  "Upload photo",
  "Upload video",
  "Upload PDF/document",
  "Journal photo",
  "GPS consent",
  "Safety Brief",
  "Offline banner",
  "Reconnect",
  "Project notes",
  "Project media tabs",
];

const missing = requiredPhrases.filter((phrase) => !smoke.includes(phrase));

if (missing.length > 0) {
  console.error("Alpha-7 critical smoke checklist is missing required phrases:");
  for (const phrase of missing) console.error(`- ${phrase}`);
  process.exit(1);
}

console.log("Alpha-7 critical smoke checklist is present.");
console.log("Use docs/CRITICAL_PATH_SMOKE_ALPHA7.md for the actual manual smoke pass.");
