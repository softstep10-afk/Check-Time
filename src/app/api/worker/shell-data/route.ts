import { NextResponse } from "next/server";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { createClient } from "@/lib/supabase/server";
import { loadWorkerShellData } from "@/lib/worker-data";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = await createClient();

  if (!AUTH_BYPASS_ENABLED) {
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle<{ id: string; role: string | null }>();

    if (profileError) {
      console.warn("[worker-shell-data] profile guard failed:", profileError.message);
    }

    if (!profile && !profileError) {
      return NextResponse.json({ error: "Worker profile not found" }, { status: 403 });
    }

    if (profile?.role === "manager" || profile?.role === "admin" || profile?.role === "owner") {
      return NextResponse.json(
        { error: "Worker shell is not available for this role", redirectTo: "/overview" },
        { status: 403 },
      );
    }
  }

  const shell = await loadWorkerShellData();

  return NextResponse.json({ shell });
}
