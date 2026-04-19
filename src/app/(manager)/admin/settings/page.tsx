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
    />
  );
}
