import { redirect } from "next/navigation";
import { AdminSettingsPage } from "@/components/manager/AdminSettingsPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";

export default async function AdminSettingsRoutePage() {
  const data = await getManagerWorkspaceData();
  if (data.manager.role !== "owner" && data.manager.role !== "admin") {
    redirect("/overview");
  }

  return (
    <AdminSettingsPage
      managerId={data.manager.id}
      managerRole={data.manager.role}
      ownerProfiles={data.profiles
        .filter((profile) => profile.role === "owner" || profile.role === "admin")
        .map((profile) => ({
          id: profile.id,
          name: profile.name,
          role: profile.role,
          isActive: profile.is_active,
        }))}
    />
  );
}
