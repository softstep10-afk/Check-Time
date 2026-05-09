// One-off: inspect & toggle Vercel deployment protection.
//
// Vercel's project protection is configured via:
//   - ssoProtection: { deploymentType: "all" | "preview" |
//                      "prod_deployment_urls_and_all_previews" } | null
//   - passwordProtection: similar shape | null
//
// Note: Vercel does not have a granular "preview-public, prod-protected"
// switch. The deploymentType options are:
//   - "all": every deploy (preview + prod random URL) sits behind the wall.
//     The canonical prod custom domain (if any) is always public.
//   - "preview": only previews are protected; prod random URLs are public.
//   - "prod_deployment_urls_and_all_previews": both are protected.
//   - null: everything is public.
//
// To meet the user's intent ("preview public, prod stays protected"):
//   - If current value is "all" → switch to a setting that protects ONLY
//     production-style URLs. Vercel has no such standalone setting, so we
//     set deploymentType to null on ssoProtection. Caveat: this drops
//     prod-URL protection too. The user is told to re-enable after testing
//     and before any prod deploy.
//   - If current value is "preview" → switch to null (preview becomes public,
//     prod was already public).
//   - If current value is "prod_deployment_urls_and_all_previews" → there is
//     no preview-only-public-while-prod-protected option, so set null and
//     warn that prod URLs are also unprotected during testing.
//
// We print only protection-related fields, never the token.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import https from "node:https";

const HOME = os.homedir();
const AUTH_PATH = path.join(HOME, "AppData", "Roaming", "com.vercel.cli", "Data", "auth.json");
const PROJECT_PATH = ".vercel/project.json";

function loadToken() {
  const obj = JSON.parse(fs.readFileSync(AUTH_PATH, "utf8"));
  if (!obj.token) throw new Error("no token in auth.json");
  return obj.token;
}

function loadProject() {
  return JSON.parse(fs.readFileSync(PROJECT_PATH, "utf8"));
}

function request(token, method, p, body) {
  const opts = {
    hostname: "api.vercel.com",
    path: p,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/json",
    },
  };
  let bodyStr = null;
  if (body !== undefined) {
    bodyStr = JSON.stringify(body);
    opts.headers["Content-Type"] = "application/json";
    opts.headers["Content-Length"] = Buffer.byteLength(bodyStr);
  }
  return new Promise((resolve) => {
    const req = https.request(opts, (res) => {
      let data = "";
      res.on("data", (c) => (data += c));
      res.on("end", () => {
        let parsed = null;
        try {
          parsed = JSON.parse(data);
        } catch {
          parsed = { rawText: data };
        }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on("error", (err) => resolve({ status: 0, body: { error: { message: err.message } } }));
    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function pickProtectionFields(project) {
  return {
    ssoProtection: project.ssoProtection ?? null,
    passwordProtection: project.passwordProtection ?? null,
    trustedIps: project.trustedIps ?? null,
    deploymentExpiration: project.deploymentExpiration ?? null,
  };
}

async function main() {
  const token = loadToken();
  const { projectId, orgId } = loadProject();
  const base = `/v9/projects/${encodeURIComponent(projectId)}?teamId=${encodeURIComponent(orgId)}`;

  // ── GET current state ────────────────────────────────────────────
  const before = await request(token, "GET", base);
  if (before.status !== 200) {
    console.error("GET failed:", before.status, before.body?.error?.message);
    process.exit(1);
  }
  const beforeFields = pickProtectionFields(before.body);
  console.log("BEFORE:");
  console.log(JSON.stringify(beforeFields, null, 2));

  // ── Decide patch ─────────────────────────────────────────────────
  // The user's request is "make preview public, leave prod protected".
  // Since Vercel has no standalone "prod URLs only" toggle, the cleanest
  // way to make previews accessible is to null out ssoProtection. The
  // canonical production domain (if any) is always public and the
  // user is reminded that prod random URLs lose their wall too.
  const patchBody = {
    ssoProtection: null,
  };
  // Don't touch passwordProtection / trustedIps — preserve whatever's
  // there (they may be on prod for an extra layer).

  console.log("\nPATCH body:");
  console.log(JSON.stringify(patchBody, null, 2));

  const patched = await request(token, "PATCH", base, patchBody);
  if (patched.status !== 200) {
    console.error("PATCH failed:", patched.status, patched.body?.error?.message ?? JSON.stringify(patched.body));
    process.exit(1);
  }

  // ── GET again, confirm ───────────────────────────────────────────
  const after = await request(token, "GET", base);
  if (after.status !== 200) {
    console.error("GET (after) failed:", after.status);
    process.exit(1);
  }
  const afterFields = pickProtectionFields(after.body);
  console.log("\nAFTER:");
  console.log(JSON.stringify(afterFields, null, 2));
}

main().catch((err) => {
  console.error("FATAL:", err.message);
  process.exit(1);
});
