// Temporary preview mode so the app can be browsed without a live session.
// Flip this back to false when you want normal auth gating again.
export const AUTH_BYPASS_ENABLED = true;

/**
 * Hardcoded auth.users / profiles UUID for the seeded demo owner.
 *
 * Keep in sync with `supabase/seed_dev.sql`. Server components that need
 * to fake out `auth.uid()` while AUTH_BYPASS_ENABLED is true should reach
 * for this constant rather than typing the literal — that way a future
 * UUID change is one-edit.
 */
export const PREVIEW_OWNER_ID = "00000000-0000-0000-0000-000000000001";
