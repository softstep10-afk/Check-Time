import { redirect } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewManagerWorkspaceData } from "@/lib/preview-data";
import { hasFinanceAccess } from "@/lib/finance-access";
import { isManagerRole } from "@/lib/manager-utils";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";
import { AnnualReportClient } from "./AnnualReportClient";

// The annual report is an aggregate-only surface — it shows org-wide
// payroll, materials, and project totals. Partial visibility doesn't
// make sense here, so non-finance users are bounced rather than handed
// a misleading "your view" of the same screen.
export const revalidate = 0;

export default async function AnnualReportRoutePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let manager: { id: string; role: Profile["role"] } | null = null;

  if (user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("id, role")
      .eq("id", user.id)
      .maybeSingle<Pick<Profile, "id" | "role">>();
    if (profile && isManagerRole(profile.role)) {
      manager = { id: profile.id, role: profile.role };
    }
  }

  // AUTH_BYPASS keeps preview deployments usable without a real session.
  // The preview manager is seeded as owner, so the finance check below
  // passes and the page renders unchanged.
  if (!manager && AUTH_BYPASS_ENABLED) {
    const preview = buildPreviewManagerWorkspaceData();
    manager = { id: preview.manager.id, role: preview.manager.role };
  }

  if (!manager) redirect("/login");

  const allowed = await hasFinanceAccess(supabase, manager);
  if (!allowed) redirect("/overview");

  return <AnnualReportClient />;
}
