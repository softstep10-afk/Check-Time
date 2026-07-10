import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GPS_CONSENT_LEGACY_STORAGE_KEY,
  buildGpsConsentInsert,
  gpsConsentStorageKey,
  hasCachedGpsConsentDecision,
  readCachedGpsConsent,
  resolveConsentGate,
  writeCachedGpsConsent,
} from "@/lib/gps-consent";

const gpsConsentSource = readFileSync(resolve(process.cwd(), "src/lib/gps-consent.ts"), "utf8");

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
  };
}

describe("GPS consent audit helpers", () => {
  it("builds the accepted consent insert payload with signed name and version", () => {
    expect(
      buildGpsConsentInsert({
        orgId: "org-1",
        workerId: "worker-1",
        signedName: " Test Worker ",
        granted: true,
        userAgent: "Mobile Safari",
      }),
    ).toMatchObject({
      org_id: "org-1",
      worker_id: "worker-1",
      signed_name: "Test Worker",
      consented: true,
      consent_version: 2,
      user_agent: "Mobile Safari",
    });
  });

  it("records skipped/no-GPS decisions without marking GPS as accepted", () => {
    expect(
      buildGpsConsentInsert({
        orgId: "org-1",
        workerId: "worker-1",
        signedName: "Test Worker",
        granted: false,
      }),
    ).toMatchObject({
      consented: false,
      signed_name: "Test Worker",
    });
  });

  it("uses a versioned cache so a future consent version can ask again", () => {
    const storage = memoryStorage({ [GPS_CONSENT_LEGACY_STORAGE_KEY]: "true" });

    expect(readCachedGpsConsent(storage, 1)).toBe("granted");
    expect(storage.getItem(gpsConsentStorageKey(1))).toBe("true");
    expect(readCachedGpsConsent(storage, 2)).toBe("unknown");

    writeCachedGpsConsent(storage, false, 1);
    expect(hasCachedGpsConsentDecision(storage, 1)).toBe(true);
    expect(readCachedGpsConsent(storage, 1)).toBe("denied");
  });

  it("reads the latest DB consent for the current consent version only", () => {
    expect(gpsConsentSource).toContain(".from(\"worker_location_consents\")");
    expect(gpsConsentSource).toContain(".eq(\"worker_id\", workerId)");
    expect(gpsConsentSource).toContain(".eq(\"consent_version\", consentVersion)");
    expect(gpsConsentSource).toContain("GPS_CONSENT_VERSION");
  });
});

describe("resolveConsentGate — DB current-version decision is the sole truth", () => {
  it("granted → track, no prompt", () => {
    expect(resolveConsentGate("granted")).toEqual({
      gpsConsented: true,
      consentDecision: "granted",
      shouldPrompt: false,
    });
  });

  it("denied → tracking off, no prompt (honored decision)", () => {
    expect(resolveConsentGate("denied")).toEqual({
      gpsConsented: false,
      consentDecision: "denied",
      shouldPrompt: false,
    });
  });

  it("unknown (no v2 row) → tracking off and PROMPT", () => {
    expect(resolveConsentGate("unknown")).toEqual({
      gpsConsented: false,
      consentDecision: "unknown",
      shouldPrompt: true,
    });
  });

  it("takes no localStorage input — a stale cache cannot change the gate or write a row", () => {
    // Both task scenarios (stale pre-v2 'granted' cache, and no cache) reduce to
    // the same DB state — "unknown" — and therefore the same prompt-and-no-write
    // outcome. The gate is a pure function of the DB decision only.
    expect(resolveConsentGate("unknown").shouldPrompt).toBe(true);
    expect(resolveConsentGate("unknown").gpsConsented).toBe(false);
    // resolveConsentGate has arity 1 (dbState only) — no storage parameter.
    expect(resolveConsentGate.length).toBe(1);
  });
});
