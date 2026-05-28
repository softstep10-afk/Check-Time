import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  GPS_CONSENT_LEGACY_STORAGE_KEY,
  buildGpsConsentInsert,
  gpsConsentStorageKey,
  hasCachedGpsConsentDecision,
  readCachedGpsConsent,
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
      consent_version: 1,
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
