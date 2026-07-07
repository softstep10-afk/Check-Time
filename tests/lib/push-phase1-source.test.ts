import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const sw = read("src/app/sw.ts");
const migration = read("supabase/migrations/00046_push_subscriptions.sql");
const subscriptions = read("src/lib/notifications/subscriptions.ts");
const webPush = read("src/lib/notifications/web-push.ts");
const subscribeRoute = read("src/app/api/worker/push/subscribe/route.ts");
const unsubscribeRoute = read("src/app/api/worker/push/unsubscribe/route.ts");
const testRoute = read("src/app/api/worker/push/test/route.ts");

describe("push Phase 1 — SW listeners are additive (guardrail intact)", () => {
  it("adds push / notificationclick / pushsubscriptionchange without any fetch handler or matcher", () => {
    expect(sw).toContain('addEventListener("push"');
    expect(sw).toContain('addEventListener("notificationclick"');
    expect(sw).toContain('addEventListener("pushsubscriptionchange"');
    expect(sw).toContain("showNotification");
    // The push code must NOT introduce a fetch event handler — that is what the
    // Task 2.1 guardrail forbids. (The pushsubscriptionchange handler calls
    // fetch() to POST the new subscription — an outgoing request, not a fetch
    // listener.) The dedicated pwa-sw-navigation-guard test enforces the rest.
    expect(sw).not.toContain('addEventListener("fetch"');
    // Guardrail predicate still present (belt-and-suspenders with the dedicated test).
    expect(sw).toContain("isNavigationOrRscRequest");
    expect(sw).toContain("navigationPreload: false");
  });
});

describe("push Phase 1 — DB is service-role only", () => {
  it("migration revokes client access and grants only to service_role", () => {
    expect(migration).toContain("create table if not exists public.push_subscriptions");
    expect(migration).toContain("references public.profiles");
    expect(migration).toContain("endpoint text not null unique");
    expect(migration).toContain("enable row level security");
    expect(migration).toContain("revoke all on public.push_subscriptions from anon, authenticated");
    expect(migration).toContain("to service_role");
    // No client (anon/authenticated) policy is granted.
    expect(migration).not.toMatch(/to\s+(anon|authenticated)/);
  });

  it("data layer no-ops (not throws) when the table is missing", () => {
    expect(subscriptions).toContain("isMissingTableError");
    expect(subscriptions).toContain("42P01");
    expect(subscriptions).toContain("PGRST205");
    // getActiveSubscriptions returns [] on error rather than throwing.
    expect(subscriptions).toContain("return [];");
  });
});

describe("push Phase 1 — routes are auth-gated and web-push reads keys only from env", () => {
  for (const [name, src] of [
    ["subscribe", subscribeRoute],
    ["unsubscribe", unsubscribeRoute],
    ["test", testRoute],
  ] as const) {
    it(`${name} route requires an authenticated caller`, () => {
      expect(src).toContain("supabase.auth.getUser()");
      expect(src).toContain('{ status: 401 }');
    });
  }

  it("the test route sends only to the caller", () => {
    expect(testRoute).toContain("sendNotificationToProfile(user.id");
  });

  it("web-push takes VAPID keys from env only and no-ops when unconfigured", () => {
    expect(webPush).toContain("process.env.WEB_PUSH_VAPID_PUBLIC_KEY");
    expect(webPush).toContain("process.env.WEB_PUSH_VAPID_PRIVATE_KEY");
    expect(webPush).toContain("process.env.WEB_PUSH_CONTACT");
    expect(webPush).toContain('status: "skipped"');
    // 404/410 from the push service → mark the subscription gone (revoked).
    expect(webPush).toContain("404");
    expect(webPush).toContain("410");
    expect(webPush).toContain('status: "gone"');
  });
});
