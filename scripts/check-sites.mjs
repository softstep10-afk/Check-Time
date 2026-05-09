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

const { data, error } = await admin.from("projects").select("id, name, site_point, radius_m, gps_radius_m");

if (error) {
  console.error("Error:", error.message);
  process.exit(1);
}

console.log(`Projects in DB: ${data.length}\n`);
for (const r of data) {
  console.log("name:", r.name);
  console.log("  site_point:", JSON.stringify(r.site_point));
  console.log("  radius_m:", r.radius_m, "| gps_radius_m:", r.gps_radius_m);
  console.log();
}
