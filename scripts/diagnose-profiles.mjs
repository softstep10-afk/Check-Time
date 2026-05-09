// Diagnose: show all profiles and whether they have a PIN set.
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
  if (!m) continue;
  let val = m[2];
  if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
  if (!(m[1] in process.env)) process.env[m[1]] = val;
}

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

const { data, error } = await admin
  .from("profiles")
  .select("id, name, role, is_active, pin_hash");

if (error) {
  console.error("Query failed:", error.message);
  process.exit(1);
}

console.log("Profiles in DB:");
for (const p of data) {
  console.log(
    `  id=${p.id.slice(0, 8)}  name=${p.name.padEnd(15)}  role=${p.role.padEnd(10)}  active=${p.is_active}  has_pin=${p.pin_hash !== null}`
  );
}
