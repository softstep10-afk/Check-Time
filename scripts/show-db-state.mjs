// Read-only snapshot of what's currently in the DB.
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

const tables = ["organizations","profiles","projects","project_assignments","supply_stores","tasks"];
for (const t of tables) {
  const { data, error, count } = await admin.from(t).select("*", { count: "exact" });
  if (error) { console.log(`${t}: ERROR ${error.message}`); continue; }
  console.log(`\n=== ${t} (${count} rows) ===`);
  for (const row of data) {
    const summary = { ...row };
    delete summary.pin_hash;
    delete summary.settings;
    delete summary.metadata;
    delete summary.site_point;
    delete summary.ai_analysis;
    console.log(" ", JSON.stringify(summary));
  }
}
