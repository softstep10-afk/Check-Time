import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";

export default async function RootPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    if (AUTH_BYPASS_ENABLED) {
      redirect("/overview");
    }

    redirect("/login");
  }

  // Get profile to determine role
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();

  // Manager-tier roles land on the dashboard; worker-tier roles go
  // straight to the clock screen. Keep this list aligned with the
  // user_role enum (see supabase/migrations/00001_foundation.sql +
  // 00003_schema_gap.sql which adds 'owner').
  if (profile?.role === "sales") {
    redirect("/schedule");
  }

  if (
    profile?.role === "owner" ||
    profile?.role === "admin" ||
    profile?.role === "manager" ||
    profile?.role === "supervisor"
  ) {
    redirect("/overview");
  }

  redirect("/clock");
}
