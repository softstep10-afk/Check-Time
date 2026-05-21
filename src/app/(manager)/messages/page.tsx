import { BulkMessageComposer } from "@/components/manager/BulkMessageComposer";
import { getManagerWorkspaceData } from "@/lib/manager-data";

export default async function MessagesPage() {
  const data = await getManagerWorkspaceData();
  const crew = data.profiles
    .filter((p) => !p.deleted_at)
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));
  const projects = data.projects
    .filter((project) => !project.deleted_at && project.status !== "archived")
    .map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }));

  return (
    <BulkMessageComposer
      orgId={data.manager.org_id}
      senderId={data.manager.id}
      senderName={data.manager.name}
      senderRole={data.manager.role}
      crew={crew}
      projects={projects}
    />
  );
}
