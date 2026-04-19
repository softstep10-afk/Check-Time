import { WorkerShell } from "@/components/worker/WorkerShell";
import { getWorkerShellData } from "@/lib/worker-data";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workerShellData = await getWorkerShellData();

  return <WorkerShell initialData={workerShellData}>{children}</WorkerShell>;
}
