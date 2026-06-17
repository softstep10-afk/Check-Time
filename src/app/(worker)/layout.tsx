import { WorkerShell } from "@/components/worker/WorkerShell";
import { getWorkerShellBootstrapData } from "@/lib/worker-data";

export default async function Layout({
  children,
}: {
  children: React.ReactNode;
}) {
  const workerShellData = await getWorkerShellBootstrapData();

  return <WorkerShell initialData={workerShellData}>{children}</WorkerShell>;
}
