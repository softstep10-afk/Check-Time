// Preview mode so the app can be browsed without a live session.
//
// Controlled by NEXT_PUBLIC_AUTH_BYPASS. Defaults to FALSE — i.e. real
// auth is required unless the env var is explicitly the string "true".
// Must use the NEXT_PUBLIC_ prefix because several client components
// branch on this constant; Next.js only inlines NEXT_PUBLIC_* into the
// browser bundle at build time.
//
// Local dev:        add `NEXT_PUBLIC_AUTH_BYPASS=true` to .env.local
//                   (gitignored) to keep current auto-login UX.
// Staging / prod:   omit the var (or set it to anything other than
//                   "true") so PIN login is enforced.
export const AUTH_BYPASS_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_BYPASS === "true";

// Temporary diagnostic — confirms in the browser console exactly what
// the deployed bundle resolved AUTH_BYPASS_ENABLED to. Remove once the
// bypass-state question is settled.
if (typeof window !== "undefined") {
  console.log(
    "[auth-bypass] AUTH_BYPASS_ENABLED =",
    AUTH_BYPASS_ENABLED,
    "(NEXT_PUBLIC_AUTH_BYPASS =",
    JSON.stringify(process.env.NEXT_PUBLIC_AUTH_BYPASS),
    ")",
  );
}

/**
 * Hardcoded auth.users / profiles UUID for the seeded demo owner.
 *
 * Keep in sync with `supabase/seed_dev.sql`. Server components that need
 * to fake out `auth.uid()` while AUTH_BYPASS_ENABLED is true should reach
 * for this constant rather than typing the literal — that way a future
 * UUID change is one-edit.
 */
export const PREVIEW_OWNER_ID = "00000000-0000-0000-0000-000000000001";
