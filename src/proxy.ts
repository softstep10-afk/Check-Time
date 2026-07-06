import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";

// In Next.js 16, Middleware was renamed to Proxy and lives at src/proxy.ts
// (see node_modules/next/dist/docs/01-app/01-getting-started/16-proxy.md).
// The functionality is identical — this is THE auth gate / session refresher.

// Routes anyone can visit without a session. `/offline` is the PWA offline boot
// shell (Task 4): a static, data-free page that only reads this device's local
// queues — it must be reachable without a session (and pre-warmed into the HTTP
// cache) so it can render when the network is gone.
const PUBLIC_PATHS = new Set(["/", "/login", "/offline"]);
const PUBLIC_PREFIXES = [
  "/api/auth/pin-login",
  "/_next",
  "/favicon",
  "/manifest",
];

function isPublicPath(pathname: string): boolean {
  if (PUBLIC_PATHS.has(pathname)) return true;
  return PUBLIC_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

/**
 * Per-request Supabase Auth session refresh + route protection.
 *
 * Implements the SSR pattern from
 *   https://supabase.com/docs/guides/auth/server-side/nextjs
 * The cookies.setAll callback rebuilds `response` so refreshed
 * session cookies actually land on the wire — anything that diverges
 * from this shape silently breaks cookie refresh in production.
 *
 * AUTH_BYPASS_ENABLED short-circuits the gate so demo deploys can be
 * browsed without a real session, but the cookie refresh still runs
 * for any real session that happens to be present.
 */
export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: must run before the response leaves the function so the
  // refreshed session cookie is included in the wire response.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  if (AUTH_BYPASS_ENABLED) {
    return response;
  }

  if (isPublicPath(pathname)) {
    // If a logged-in user lands on /login, send them home.
    if (user && pathname === "/login") {
      const url = request.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
    return response;
  }

  if (!user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return response;
}

export const config = {
  // Run on every path except static assets and Next internals — these
  // are excluded for performance, not security.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|.*\\.[^/]+$).*)",
  ],
};
