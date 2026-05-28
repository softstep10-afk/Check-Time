#!/usr/bin/env node

import { execFileSync } from "node:child_process";

const PRODUCTION_URL = "https://check-time-five.vercel.app";

function run(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function lines(value) {
  return value ? value.split(/\r?\n/).filter(Boolean) : [];
}

function parseVercelInspect(output) {
  if (!output) {
    return {
      available: false,
      status: "unavailable",
      deploymentId: "unknown",
      deploymentUrl: "unknown",
      aliases: [],
      commit: "unknown",
    };
  }

  const statusMatch = output.match(/status\s+([^\r\n]+)/i);
  const idMatch = output.match(/(dpl_[A-Za-z0-9]+)/);
  const urlMatch = output.match(/https:\/\/[^\s]+\.vercel\.app/i);
  const commitMatch =
    output.match(/(?:commit|source)\s+(?:sha\s+)?([a-f0-9]{7,40})/i) ??
    output.match(/\b([a-f0-9]{40})\b/i);
  const aliases = lines(output).filter((line) => line.includes(PRODUCTION_URL));

  return {
    available: true,
    status: statusMatch?.[1]?.trim() ?? "unknown",
    deploymentId: idMatch?.[1] ?? "unknown",
    deploymentUrl: urlMatch?.[0] ?? "unknown",
    aliases,
    commit: commitMatch?.[1] ?? "unknown",
  };
}

const branch = run("git", ["branch", "--show-current"]) ?? "unknown";
const head = run("git", ["rev-parse", "HEAD"]) ?? "unknown";
const status = run("git", ["status", "--short"]) ?? "";
const recentCommits = lines(run("git", ["log", "--oneline", "-10"]));
const productionInspect = parseVercelInspect(run("vercel", ["inspect", PRODUCTION_URL]));

const localButNotDeployed =
  productionInspect.commit !== "unknown"
    ? lines(run("git", ["log", "--oneline", `${productionInspect.commit}..HEAD`]))
    : [];

const audit = {
  generatedAt: new Date().toISOString(),
  productionUrl: PRODUCTION_URL,
  branch,
  head,
  clean: status.trim().length === 0,
  dirtyFiles: lines(status),
  recentCommits,
  productionInspect,
  localButNotDeployed,
  recommendation:
    status.trim().length > 0
      ? "do not deploy: local tree is dirty"
      : productionInspect.commit === "unknown"
        ? "investigate: production commit was not available from Vercel inspect"
        : productionInspect.commit.startsWith(head.slice(0, 8)) || head.startsWith(productionInspect.commit)
          ? "do not deploy: production appears aligned with local HEAD"
          : "investigate or deploy only after owner approval: local HEAD differs from inspected production commit",
};

console.log(JSON.stringify(audit, null, 2));
