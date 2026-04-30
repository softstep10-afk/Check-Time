import { createHmac, timingSafeEqual } from "crypto";

/**
 * Mux signs every webhook delivery with `Mux-Signature: t=<unix>,v1=<hex>`.
 * The signed payload is `${timestamp}.${rawBody}`, signed with HMAC-SHA256
 * using the webhook signing secret displayed in the Mux dashboard when the
 * webhook is created.
 *
 * Verifier intentionally returns a tagged result instead of throwing so the
 * route handler can pick the correct HTTP status without a try/catch dance.
 */

export type MuxSignatureResult =
  | { ok: true }
  | {
      ok: false;
      error:
        | "missing_secret"
        | "missing_header"
        | "malformed_header"
        | "stale_timestamp"
        | "bad_signature";
    };

/** Reject deliveries whose timestamp is more than this many seconds off. */
export const MUX_TIMESTAMP_TOLERANCE_SECONDS = 300;

export function verifyMuxSignature(args: {
  rawBody: string;
  header: string | null | undefined;
  secret: string | null | undefined;
  /** Override Date.now() for deterministic tests; defaults to current time. */
  now?: number;
}): MuxSignatureResult {
  if (!args.secret) return { ok: false, error: "missing_secret" };
  if (!args.header) return { ok: false, error: "missing_header" };

  const parts: Record<string, string> = {};
  for (const piece of args.header.split(",")) {
    const eq = piece.indexOf("=");
    if (eq === -1) continue;
    const key = piece.slice(0, eq).trim();
    const value = piece.slice(eq + 1).trim();
    if (key && value && !(key in parts)) parts[key] = value;
  }

  const ts = parts.t;
  const sig = parts.v1;
  if (!ts || !sig) return { ok: false, error: "malformed_header" };

  const tsNumber = Number.parseInt(ts, 10);
  if (!Number.isFinite(tsNumber)) return { ok: false, error: "malformed_header" };

  const now = args.now ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - tsNumber) > MUX_TIMESTAMP_TOLERANCE_SECONDS) {
    return { ok: false, error: "stale_timestamp" };
  }

  const expectedHex = createHmac("sha256", args.secret)
    .update(`${ts}.${args.rawBody}`)
    .digest("hex");

  if (sig.length !== expectedHex.length) {
    return { ok: false, error: "bad_signature" };
  }

  let sigBuf: Buffer;
  try {
    sigBuf = Buffer.from(sig, "hex");
  } catch {
    return { ok: false, error: "bad_signature" };
  }
  const expectedBuf = Buffer.from(expectedHex, "hex");
  if (sigBuf.length !== expectedBuf.length) {
    return { ok: false, error: "bad_signature" };
  }
  if (!timingSafeEqual(sigBuf, expectedBuf)) {
    return { ok: false, error: "bad_signature" };
  }

  return { ok: true };
}
