import { ClientsPage } from "@/components/manager/ClientsPage";
import { getClientsDirectoryData } from "@/lib/clients-data";

export const revalidate = 0;

export default async function ClientsRoutePage() {
  const data = await getClientsDirectoryData();
  return <ClientsPage clients={data.clients} />;
}
