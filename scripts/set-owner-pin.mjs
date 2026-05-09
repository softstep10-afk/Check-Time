// One-off: set PIN for seed Owner so /login works through the UI.
// Usage from repo root:
//   node scripts/set-owner-pin.mjs
//
// Reads .env.local directly (no dotenv dep). Deletes safely after you've
// confirmed login — PIN stays on the profile row.

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { hash } from "@node-rs/argon2";

const PIN = "9999";
const OWNER_ID = "00000000-0000-0000-0000-000000000001";

// Parse .env.local into process.env without adding a new dependency.
for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  if (val.startsWith("'") && val.endsWith("'")) val = val.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = val;
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceKey) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(1);
}

const admin = createClient(url, serviceKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const pinHash = await hash(PIN);

const { error } = await admin
  .from("profiles")
  .update({ pin_hash: pinHash })
  .eq("id", OWNER_ID);

if (error) {
  console.error("Update failed:", error.message);
  process.exit(1);
}

console.log(`Done. Login at http://localhost:3000/login with PIN ${PIN}`);
