import { createBrowserClient } from "@supabase/ssr";

export const AUTH_EXPIRED_EVENT = "check-time:auth-expired";

const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

type FetchInput = Parameters<typeof fetch>[0];

function requestUrl(input: FetchInput): string {
  if (typeof input === "string") return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function isSupabaseRestOrStorageUrl(input: FetchInput): boolean {
  const raw = requestUrl(input);
  return raw.includes("/rest/v1/") || raw.includes("/storage/v1/");
}

export function isAuthEndpoint(input: FetchInput): boolean {
  return requestUrl(input).includes("/auth/v1/");
}

export function isProtectedBrowserPath(): boolean {
  if (typeof window === "undefined") return false;
  const path = window.location.pathname;
  if (path === "/login" || path.startsWith("/login/")) return false;
  return true;
}

export function authorizationUsesAnonKey(headers: Headers): boolean {
  if (!SUPABASE_ANON_KEY) return false;
  const authorization = headers.get("authorization") ?? "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  return token === SUPABASE_ANON_KEY;
}

export function bodyLooksAuthExpired(status: number, bodyText: string): boolean {
  if (status !== 401 && status !== 403) return false;
  const text = bodyText.toLowerCase();
  return (
    text.includes("jwt expired") ||
    text.includes("jwt is expired") ||
    text.includes("invalid jwt") ||
    text.includes("invalid token") ||
    text.includes("missing authorization") ||
    text.includes("not authenticated") ||
    text.includes("auth session missing") ||
    text.includes("session expired")
  );
}

function shouldSkipAuthExpiredClassification(input: FetchInput, response: Response): boolean {
  if (isAuthEndpoint(input)) return true;
  if (!isSupabaseRestOrStorageUrl(input)) return true;
  if (response.status === 0) return true;
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return false;
}

function dispatchAuthExpired(reason: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(AUTH_EXPIRED_EVENT, { detail: { reason } }));
}

export const authAwareFetch: typeof fetch = async (input, init) => {
  const response = await globalThis.fetch(input, init);

  if (shouldSkipAuthExpiredClassification(input, response)) {
    return response;
  }

  const headers = new Headers(init?.headers);
  if (isProtectedBrowserPath() && authorizationUsesAnonKey(headers)) {
    dispatchAuthExpired("supabase-anon-fallback");
    return response;
  }

  if (response.status === 401 || response.status === 403) {
    const bodyText = await response.clone().text().catch(() => "");
    if (bodyLooksAuthExpired(response.status, bodyText)) {
      dispatchAuthExpired(`supabase-http-${response.status}`);
    }
  }

  return response;
};

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: {
        fetch: authAwareFetch,
      },
    },
  );
}
