import { notFound, redirect } from "next/navigation";
import { UserPermissionsPage } from "@/components/manager/UserPermissionsPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";
import { fetchUserCapabilities } from "@/lib/capabilities";
import { createClient } from "@/lib/supabase/server";
import { isManagerRole } from "@/lib/manager-utils";

export default async function UserPermissionsRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getManagerWorkspaceData();

  // Page-level gate. The same check exists implicitly in
  // getManagerWorkspaceData (redirects non-managers to /clock), but spell
  // it out for owner/manager-only access.
  if (!isManagerRole(data.manager.role)) {
    redirect("/overview");
  }

  const target = data.profiles.find((profile) => profile.id === id);
  if (!target) notFound();

  const supabase = await createClient();
  const initialCapabilities = await fetchUserCapabilities(supabase, target.id);

  return (
    <UserPermissionsPage
      managerId={data.manager.id}
      target={{ id: target.id, name: target.name, role: target.role }}
      initialCapabilities={initialCapabilities}
    />
  );
}
