import { ClientDetailPage } from "@/components/manager/ClientDetailPage";
import { getClientDetailData } from "@/lib/clients-data";

export const revalidate = 0;

export default async function ClientDetailRoutePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const client = await getClientDetailData(id);
  return <ClientDetailPage client={client} />;
}
