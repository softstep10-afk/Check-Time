import { BulkMessageComposer } from "@/components/manager/BulkMessageComposer";
import { getManagerWorkspaceData } from "@/lib/manager-data";

export default async function MessagesPage() {
  const data = await getManagerWorkspaceData();
  const crew = data.profiles
    .filter((p) => !p.deleted_at)
    .map((p) => ({ id: p.id, name: p.name, role: p.role }));

  return (
    <BulkMessageComposer
      orgId={data.manager.org_id}
      senderId={data.manager.id}
      senderName={data.manager.name}
      crew={crew}
    />
  );
}
