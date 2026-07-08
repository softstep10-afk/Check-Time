// Client-side write channel for GPS location consent.
//
// The browser no longer inserts worker_location_consents directly (a WA-legal
// append-only record). It POSTs only the two fields it legitimately owns —
// signedName and the granted/denied decision — to the server route, which
// stamps every trusted field (worker_id, org_id, consent_version, user_agent,
// ip_address, signed_at). The return shape mirrors the old writeConsent()
// contract so call sites change minimally.

export async function postGpsConsent(input: {
  signedName: string;
  granted: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/worker/location-consent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ signedName: input.signedName, granted: input.granted }),
    });
    const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (res.ok && data?.ok) return { ok: true };
    return { ok: false, error: data?.error ?? `Consent write failed (HTTP ${res.status}).` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Consent write failed." };
  }
}
