// Post-deploy smoke: the programmatic (browser-free, unauthenticated) parts of
// docs/DEPLOY_SMOKE.md. Confirms the app is up, the service-worker script is
// served correctly (no-store + a build SHA), the /offline shell is reachable, and
// the PWA manifest is served. It CANNOT see SPA navigation, auth, or install —
// those are the browser steps in docs/DEPLOY_SMOKE.md.
//
//   PRODUCTION_URL=https://... npm run smoke:deploy
//   EXPECTED_SHA=<new commit sha> PRODUCTION_URL=... npm run smoke:deploy   (assert deploy took)
//   PREV_SHA=<old commit sha>     PRODUCTION_URL=... npm run smoke:deploy   (assert build changed)
//
// No new deps: uses global fetch (Node 18+), same convention as the other smoke scripts.

const base = (process.env.PRODUCTION_URL ?? "https://check-time-five.vercel.app").replace(/\/$/, "");
const expectedSha = process.env.EXPECTED_SHA?.trim() || null;
const prevSha = process.env.PREV_SHA?.trim() || null;

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function request(path, { redirect = "manual", readBody = false, timeoutMs = 10_000 } = {}) {
  const t = timeoutSignal(timeoutMs);
  try {
    const response = await fetch(`${base}${path}`, { redirect, signal: t.signal });
    return {
      ok: true,
      status: response.status,
      cacheControl: response.headers.get("cache-control") ?? "",
      contentType: response.headers.get("content-type") ?? "",
      location: response.headers.get("location") ?? "",
      body: readBody ? await response.text() : "",
    };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    t.cancel();
  }
}

const results = [];
function check(name, pass, detail = "") {
  results.push({ name, pass, detail });
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
}

console.log(`Deploy smoke (unauthenticated) against ${base}`);

// 1. Service worker: served, no-store, javascript, carries a versioned build SHA.
const sw = await request("/serwist/sw.js", { readBody: true });
if (!sw.ok) {
  check("/serwist/sw.js reachable", false, sw.error);
} else {
  check("/serwist/sw.js 200", sw.status === 200, `status ${sw.status}`);
  check("/serwist/sw.js no-store", /no-store/i.test(sw.cacheControl), sw.cacheControl || "(no cache-control)");
  check("/serwist/sw.js is javascript", /javascript/i.test(sw.contentType), sw.contentType || "(no content-type)");
  check("/serwist/sw.js has versioned cache prefix", sw.body.includes("ct-app-"));
  const shaMatch = sw.body.match(/[0-9a-f]{40}/);
  const servedSha = shaMatch ? shaMatch[0] : null;
  check("build SHA embedded in worker", Boolean(servedSha), servedSha ? servedSha : "(none — is APP_BUILD_COMMIT_SHA set?)");
  if (expectedSha) {
    check("served SHA matches EXPECTED_SHA (deploy took)", servedSha === expectedSha, `served ${servedSha ?? "?"} vs expected ${expectedSha}`);
  }
  if (prevSha) {
    check("served SHA differs from PREV_SHA (build changed)", servedSha !== prevSha, `served ${servedSha ?? "?"} vs prev ${prevSha}`);
  }
}

// 2. Offline boot shell reachable (public, Task 4).
const offline = await request("/offline", { redirect: "follow" });
check("/offline 200", offline.ok && offline.status === 200, offline.ok ? `status ${offline.status}` : offline.error);

// 3. PWA manifest served.
const manifest = await request("/manifest.json", { redirect: "follow", readBody: true });
if (!manifest.ok || manifest.status !== 200) {
  check("/manifest.json 200", false, manifest.ok ? `status ${manifest.status}` : manifest.error);
} else {
  let standalone = false;
  try {
    standalone = JSON.parse(manifest.body)?.display === "standalone";
  } catch {
    /* fall through to fail */
  }
  check("/manifest.json is a standalone PWA manifest", standalone);
}

// 4. App root responds (redirect or 200, not a 5xx) — the app is up.
const root = await request("/");
check(
  "app root is up (not 5xx)",
  root.ok && root.status < 500,
  root.ok ? `status ${root.status}${root.location ? ` → ${root.location}` : ""}` : root.error,
);

const failed = results.filter((r) => !r.pass);
console.log("");
console.log(`${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length > 0) {
  console.log("Deploy smoke FAILED. This does not cover SPA navigation / auth / install — run the");
  console.log("browser steps in docs/DEPLOY_SMOKE.md before rolling out.");
  process.exit(1);
}
console.log("Programmatic deploy smoke passed. Now run the browser steps in docs/DEPLOY_SMOKE.md.");
