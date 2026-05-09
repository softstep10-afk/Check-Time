// One-off: push the 7 required env vars from .env.local into the
// Vercel project's Preview environment via REST API. The CLI's
// `vercel env add ... preview` flow is currently broken when the
// project has no connected Git repo (CLI insists on a git_branch
// 3rd arg, but the API rejects gitBranch when no repo is linked).
// REST direct path avoids that whole mess. Output is key + OK/FAIL,
// values never reach stdout.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";

const HOME = os.homedir();
const AUTH_PATH = path.join(HOME, "AppData", "Roaming", "com.vercel.cli", "Data", "auth.json");
const PROJECT_PATH = ".vercel/project.json";
const ENV_PATH = ".env.local";

const TARGET_KEYS = [
  "NEXT_PUBLIC_SUPABASE_URL",
  "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  "SUPABASE_SERVICE_ROLE_KEY",
  "NEXT_PUBLIC_GOOGLE_MAPS_KEY",
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "NEXT_PUBLIC_AUTH_BYPASS",
];

function loadAuth() {
  const raw = fs.readFileSync(AUTH_PATH, "utf8");
  const obj = JSON.parse(raw);
  if (!obj.token) throw new Error("auth.json has no token");
  return obj.token;
}

function loadProject() {
  const raw = fs.readFileSync(PROJECT_PATH, "utf8");
  return JSON.parse(raw);
}

function parseDotenv(text) {
  const map = {};
  for (const lineRaw of text.split(/\r?\n/)) {
    const line = lineRaw.trimEnd();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1);
    // Strip optional surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    map[key] = value;
  }
  return map;
}

function postEnv(token, projectId, teamId, key, value) {
  const body = JSON.stringify({
    key,
    value,
    target: ["preview"],
    type: "encrypted",
  });
  const opts = {
    hostname: "api.vercel.com",
    path: `/v10/projects/${encodeURIComponent(projectId)}/env?teamId=${encodeURIComponent(teamId)}`,
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": Buffer.byteLength(body),
      Authorization: `Bearer ${token}`,
    },
  };
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (chunk) => (data += chunk));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {}
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", (err) => resolve({ status: 0, body: { error: { message: err.message } } }));
    req.write(body);
    req.end();
  });
}

async function main() {
  const token = loadAuth();
  const project = loadProject();
  const env = parseDotenv(fs.readFileSync(ENV_PATH, "utf8"));

  // Critical sanity check: the Supabase URL must be the active project,
  // not the deprecated one.
  const url = env["NEXT_PUBLIC_SUPABASE_URL"] ?? "";
  if (!url.includes("vlrajjwbaxikbwvqdpft")) {
    console.error("STOP: NEXT_PUBLIC_SUPABASE_URL does not match expected project ref");
    process.exit(2);
  }
  if (url.includes("khmcdtrzqfqabdpbcjkj")) {
    console.error("STOP: NEXT_PUBLIC_SUPABASE_URL still contains deprecated project ref");
    process.exit(2);
  }

  for (const key of TARGET_KEYS) {
    let value;
    if (key === "NEXT_PUBLIC_AUTH_BYPASS") {
      value = "false"; // Per spec: literal "false" regardless of .env.local
    } else {
      value = env[key];
    }
    if (value === undefined || value === "") {
      console.log(`${key}: FAIL (no value in .env.local)`);
      continue;
    }
    const res = await postEnv(token, project.projectId, project.orgId, key, value);
    if (res.status >= 200 && res.status < 300) {
      console.log(`${key}: OK`);
    } else if (res.status === 400 && /already exists/i.test(res.body?.error?.message ?? "")) {
      console.log(`${key}: SKIP (already on Vercel)`);
    } else {
      const msg = res.body?.error?.message ?? `http ${res.status}`;
      console.log(`${key}: FAIL (${msg})`);
    }
  }
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
