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

const { data: profiles } = await admin
  .from("profiles")
  .select("id, name, role, current_project, is_active");

const { data: consents } = await admin
  .from("worker_location_consents")
  .select("worker_id, consented, signed_at");

const { data: locs } = await admin
  .from("worker_live_locations")
  .select("worker_id, lat, lng, recorded_at")
  .order("recorded_at", { ascending: false });

console.log("=== Profiles ===");
for (const p of profiles) {
  const clocked = p.current_project ? "CLOCKED-IN → " + p.current_project.slice(0, 8) : "not clocked in";
  console.log(`  ${p.name} (${p.role}): ${p.is_active ? "active" : "inactive"}, ${clocked}`);
}

console.log("\n=== GPS consents ===");
if (!consents || consents.length === 0) console.log("  (NO consents — workers never agreed to GPS)");
for (const c of consents ?? []) {
  const who = profiles.find(p => p.id === c.worker_id);
  console.log(`  ${who?.name ?? c.worker_id}: consented=${c.consented} at ${c.signed_at}`);
}

console.log("\n=== worker_live_locations rows ===");
if (!locs || locs.length === 0) console.log("  (NO location rows — nobody's device is sending GPS)");
for (const l of (locs ?? []).slice(0, 10)) {
  const who = profiles.find(p => p.id === l.worker_id);
  const ageMin = Math.round((Date.now() - new Date(l.recorded_at).getTime()) / 60000);
  console.log(`  ${who?.name ?? l.worker_id}: (${l.lat}, ${l.lng}) — ${ageMin} min ago`);
}
console.log(`Total rows: ${locs?.length ?? 0}`);
