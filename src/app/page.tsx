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

  if (profile?.role === "manager" || profile?.role === "admin") {
    redirect("/overview");
  }

  redirect("/clock");
}
