import { afterEach, describe, expect, it, vi } from "vitest";

const ANON_KEY = "anon-key";
const REST_URL = "https://example.supabase.co/rest/v1/tasks";
const AUTH_URL = "https://example.supabase.co/auth/v1/token";

async function loadAuthAwareFetch(pathname = "/worker") {
  vi.resetModules();
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = ANON_KEY;

  const dispatchEvent = vi.fn();

  vi.stubGlobal("window", {
    location: { pathname },
    dispatchEvent,
  });
  vi.stubGlobal("navigator", { onLine: true });
  vi.stubGlobal(
    "CustomEvent",
    class TestCustomEvent {
      type: string;
      detail: unknown;

      constructor(type: string, init?: { detail?: unknown }) {
        this.type = type;
        this.detail = init?.detail;
      }
    },
  );

  const clientModule = await import("@/lib/supabase/client");
  return { authAwareFetch: clientModule.authAwareFetch, dispatchEvent };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
});

describe("authAwareFetch", () => {
  it("dispatches when Supabase REST returns 401 with JWT-expired text", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("JWT expired", { status: 401 })));

    await authAwareFetch(REST_URL, {
      headers: { Authorization: "Bearer real-user-jwt" },
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "check-time:auth-expired",
      detail: { reason: "supabase-http-401" },
    });
  });

  it("dispatches when a protected-page Supabase REST request uses the anon key", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch("/clock");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("[]", { status: 200 })));

    await authAwareFetch(REST_URL, {
      headers: { Authorization: `Bearer ${ANON_KEY}` },
    });

    expect(dispatchEvent).toHaveBeenCalledTimes(1);
    expect(dispatchEvent.mock.calls[0]?.[0]).toMatchObject({
      type: "check-time:auth-expired",
      detail: { reason: "supabase-anon-fallback" },
    });
  });

  it("does not dispatch for a real user JWT with a 403 permission-denied response", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch();
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("permission denied for table tasks", { status: 403 })),
    );

    await authAwareFetch(REST_URL, {
      headers: { Authorization: "Bearer real-user-jwt" },
    });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not dispatch when fetch fails before any HTTP response", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch();
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));

    await expect(
      authAwareFetch(REST_URL, {
        headers: { Authorization: "Bearer real-user-jwt" },
      }),
    ).rejects.toThrow("Failed to fetch");

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("ignores Supabase auth endpoints", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("JWT expired", { status: 401 })));

    await authAwareFetch(AUTH_URL, {
      headers: { Authorization: "Bearer real-user-jwt" },
    });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  // PWA Task 6, invariant 3: offline / status-0 network failures must never be
  // classified as auth-expired — otherwise coming back online (or a dropped
  // request mid-session) would bounce the crew to /login and interrupt sync.
  it("does not dispatch when navigator is offline (even on a 401)", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch("/clock");
    vi.stubGlobal("navigator", { onLine: false });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("JWT expired", { status: 401 })));

    await authAwareFetch(REST_URL, { headers: { Authorization: "Bearer real-user-jwt" } });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });

  it("does not dispatch on a status-0 (network-failure) response", async () => {
    const { authAwareFetch, dispatchEvent } = await loadAuthAwareFetch("/clock");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ status: 0, clone: () => ({ text: async () => "" }) } as unknown as Response),
    );

    await authAwareFetch(REST_URL, { headers: { Authorization: "Bearer real-user-jwt" } });

    expect(dispatchEvent).not.toHaveBeenCalled();
  });
});
