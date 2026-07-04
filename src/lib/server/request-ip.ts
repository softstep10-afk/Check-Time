import "server-only";

type ClientIpSource = {
  // Next 16 removed NextRequest.ip, but keep reading it defensively in case a
  // future runtime restores it — when present it is the only fully trusted source.
  ip?: string | null;
  headers: { get(name: string): string | null };
};

/**
 * Extract a spoofing-resistant client IP for rate-limit bucketing.
 *
 * A client controls its own request headers, so we must NEVER trust the
 * LEFTMOST token of `x-forwarded-for` — the classic spoof is to prepend a fake
 * IP (`X-Forwarded-For: 1.2.3.4, <realip>`) to mint a fresh rate-limit bucket
 * per request. Under Vercel's proxy model the real connecting IP is appended as
 * the LAST hop and mirrored into the platform-set `x-real-ip`. So we prefer the
 * single-value platform headers, and for `x-forwarded-for` we take the RIGHTMOST
 * token only. Falls back to a stable literal so a missing header still buckets.
 */
export function readTrustedClientIp(source: ClientIpSource): string {
  const runtimeIp = typeof source.ip === "string" ? source.ip.trim() : "";
  if (runtimeIp) return runtimeIp;

  const realIp = source.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;

  const forwardedFor = source.headers.get("x-forwarded-for");
  if (forwardedFor) {
    const hops = forwardedFor
      .split(",")
      .map((hop) => hop.trim())
      .filter(Boolean);
    if (hops.length > 0) return hops[hops.length - 1];
  }

  const cfIp = source.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp;

  return "unknown";
}
