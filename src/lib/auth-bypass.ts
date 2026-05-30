// Preview mode so the app can be browsed without a live session.
//
// Defaults to FALSE. Local development can opt in with
// NEXT_PUBLIC_AUTH_BYPASS=true. Hosted non-production deploys need the
// additional NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION=true flag.
// Vercel production is always forced back to real auth, even if these
// public flags are accidentally present.
const DEPLOY_ENV = process.env.VERCEL_ENV ?? process.env.NEXT_PUBLIC_VERCEL_ENV;
const IS_VERCEL_DEPLOYMENT = process.env.VERCEL === "1" || Boolean(DEPLOY_ENV);
const IS_VERCEL_PRODUCTION = DEPLOY_ENV === "production";
const IS_LOCAL_DEVELOPMENT =
  process.env.NODE_ENV === "development" && !IS_VERCEL_DEPLOYMENT;
const IS_EXPLICIT_NON_PRODUCTION_BYPASS =
  process.env.NEXT_PUBLIC_AUTH_BYPASS_ALLOW_NON_PRODUCTION === "true" &&
  (DEPLOY_ENV === "preview" || DEPLOY_ENV === "development");

export const AUTH_BYPASS_ENABLED =
  process.env.NEXT_PUBLIC_AUTH_BYPASS === "true" &&
  !IS_VERCEL_PRODUCTION &&
  (IS_LOCAL_DEVELOPMENT || IS_EXPLICIT_NON_PRODUCTION_BYPASS);

/**
 * Hardcoded auth.users / profiles UUID for the seeded demo owner.
 *
 * Keep in sync with `supabase/seed_dev.sql`. Server components that need
 * to fake out `auth.uid()` while AUTH_BYPASS_ENABLED is true should reach
 * for this constant rather than typing the literal — that way a future
 * UUID change is one-edit.
 */
export const PREVIEW_OWNER_ID = "00000000-0000-0000-0000-000000000001";
