const productionUrl = process.env.PRODUCTION_URL ?? "https://check-time-five.vercel.app";
const localUrl = process.env.LOCAL_URL ?? "http://localhost:3000";

function timeoutSignal(ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, cancel: () => clearTimeout(timer) };
}

async function request(url, options = {}) {
  const timeout = timeoutSignal(options.timeoutMs ?? 10_000);
  try {
    const response = await fetch(url, {
      redirect: options.redirect ?? "manual",
      signal: timeout.signal,
    });
    const text = options.readBody ? await response.text() : "";
    return {
      ok: true,
      status: response.status,
      location: response.headers.get("location"),
      text,
    };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    timeout.cancel();
  }
}

function assert(condition, message, details) {
  if (!condition) {
    const suffix = details ? ` ${JSON.stringify(details)}` : "";
    throw new Error(`${message}${suffix}`);
  }
}

async function checkProduction() {
  const root = await request(productionUrl);
  assert(root.ok, "Production root request failed", root);
  assert([301, 302, 303, 307, 308].includes(root.status), "Production root should redirect", root);
  assert((root.location ?? "").includes("/login"), "Production root should redirect to /login", root);

  const login = await request(`${productionUrl}/login`, { redirect: "follow", readBody: true });
  assert(login.ok, "Production /login request failed", login);
  assert(login.status === 200, "Production /login should return 200", { status: login.status });
  assert(
    login.text.includes("CHECK-TIME") ||
      login.text.includes("Введите код входа") ||
      login.text.includes("4-12"),
    "Production /login did not look like the login page",
  );

  const resetFile = await request(`${productionUrl}/supabase/migrations/00099_wash_and_reset.sql`);
  assert(resetFile.ok, "Production reset-file check failed", resetFile);
  assert(resetFile.status === 404, "Dangerous reset SQL should not be served by production", resetFile);
}

async function checkLocalIfRunning() {
  const login = await request(`${localUrl}/login`, { redirect: "follow", readBody: true, timeoutMs: 3_000 });
  if (!login.ok) {
    console.log(`Local smoke skipped: ${localUrl} is not reachable.`);
    return;
  }
  assert(login.status === 200, "Local /login should return 200", { status: login.status });

  const protectedRoute = await request(`${localUrl}/projects`);
  assert(protectedRoute.ok, "Local protected route request failed", protectedRoute);
  assert(
    [301, 302, 303, 307, 308].includes(protectedRoute.status) &&
      (protectedRoute.location ?? "").includes("/login"),
    "Local protected route should redirect to /login without a session",
    protectedRoute,
  );
}

console.log("Alpha-7 public smoke");
console.log("Mode: unauthenticated GET/redirect checks only. No login or mutation.");

await checkProduction();
await checkLocalIfRunning();

console.log("Public smoke passed.");

