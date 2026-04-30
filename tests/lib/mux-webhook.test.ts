import { describe, expect, it } from "vitest";
import { createHmac } from "crypto";
import { verifyMuxSignature } from "@/lib/mux-webhook";

const SECRET = "test-secret-key";
const NOW = 1_730_000_000; // fixed reference instant for tests

function makeHeader(body: string, ts: number, secret = SECRET): string {
  const sig = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  return `t=${ts},v1=${sig}`;
}

describe("verifyMuxSignature", () => {
  it("accepts a fresh, correctly signed payload", () => {
    const body = '{"type":"video.asset.ready","data":{"id":"abc"}}';
    const header = makeHeader(body, NOW);
    expect(
      verifyMuxSignature({ rawBody: body, header, secret: SECRET, now: NOW }),
    ).toEqual({ ok: true });
  });

  it("rejects when the secret env var is missing", () => {
    const result = verifyMuxSignature({
      rawBody: "{}",
      header: "t=1,v1=00",
      secret: null,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, error: "missing_secret" });
  });

  it("rejects when the Mux-Signature header is missing", () => {
    const result = verifyMuxSignature({
      rawBody: "{}",
      header: null,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, error: "missing_header" });
  });

  it("rejects a malformed header (no v1)", () => {
    const result = verifyMuxSignature({
      rawBody: "{}",
      header: "t=1234567890",
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, error: "malformed_header" });
  });

  it("rejects a malformed header (garbage)", () => {
    const result = verifyMuxSignature({
      rawBody: "{}",
      header: "totally-not-a-mux-header",
      secret: SECRET,
      now: NOW,
    });
    expect(result.ok).toBe(false);
  });

  it("rejects timestamps older than the 5-minute tolerance", () => {
    const body = "{}";
    const header = makeHeader(body, NOW - 600);
    expect(
      verifyMuxSignature({ rawBody: body, header, secret: SECRET, now: NOW }),
    ).toEqual({ ok: false, error: "stale_timestamp" });
  });

  it("rejects timestamps in the future beyond the tolerance", () => {
    const body = "{}";
    const header = makeHeader(body, NOW + 600);
    expect(
      verifyMuxSignature({ rawBody: body, header, secret: SECRET, now: NOW }),
    ).toEqual({ ok: false, error: "stale_timestamp" });
  });

  it("accepts a payload right at the edge of the tolerance window", () => {
    const body = "{}";
    const header = makeHeader(body, NOW - 299);
    expect(
      verifyMuxSignature({ rawBody: body, header, secret: SECRET, now: NOW }).ok,
    ).toBe(true);
  });

  it("rejects when the body has been tampered with", () => {
    const original = '{"data":{"id":"abc"}}';
    const tampered = '{"data":{"id":"xyz"}}';
    const header = makeHeader(original, NOW);
    expect(
      verifyMuxSignature({ rawBody: tampered, header, secret: SECRET, now: NOW }),
    ).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects when the secret has been changed", () => {
    const body = "{}";
    const header = makeHeader(body, NOW);
    expect(
      verifyMuxSignature({
        rawBody: body,
        header,
        secret: "different-secret",
        now: NOW,
      }),
    ).toEqual({ ok: false, error: "bad_signature" });
  });

  it("rejects a signature value of the wrong length", () => {
    const result = verifyMuxSignature({
      rawBody: "{}",
      header: `t=${NOW},v1=deadbeef`,
      secret: SECRET,
      now: NOW,
    });
    expect(result).toEqual({ ok: false, error: "bad_signature" });
  });
});
