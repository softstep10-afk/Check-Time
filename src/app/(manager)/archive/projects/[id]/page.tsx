import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArchiveProjectMediaList,
  type ArchiveProjectMediaItem,
} from "@/components/manager/ArchiveProjectMediaList";
import { isArchivedProject } from "@/lib/archive-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getArchivePageData } from "@/lib/manager-data";
import { buildManagerSessions } from "@/lib/manager-utils";
import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { createClient } from "@/lib/supabase/server";
import { formatDurationCompact } from "@/lib/worker-utils";

export const revalidate = 0;

function receiptAmount(metadata: Record<string, unknown>): number | null {
  const value = metadata.amount;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function playbackMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
  const allowed: Record<string, unknown> = {};
  for (const key of [
    "playback_path",
    "playback_mime_type",
    "mux_playback_id",
    "transcoding_status",
    "transcoding_error",
  ]) {
    if (typeof metadata[key] === "string") {
      allowed[key] = metadata[key];
    }
  }
  return allowed;
}

export default async function ArchivedProjectDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const data = await getArchivePageData();
  const project = data.projects.find((item) => item.id === id && isArchivedProject(item));
  if (!project) notFound();

  const supabase = await createClient();
  const managerHasFinanceAccess = await hasFinanceAccess(supabase, {
    id: data.manager.id,
    role: data.manager.role,
  });
  const profilesById = new Map(data.profiles.map((profile) => [profile.id, profile]));
  const sessions = buildManagerSessions(data)
    .filter((session) => session.projectId === project.id)
    .sort((left, right) => new Date(right.clockInTime).getTime() - new Date(left.clockInTime).getTime());
  const projectTasks = data.tasks
    .filter((task) => !task.deleted_at && task.project_id === project.id)
    .sort((left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime());
  const mediaItems: ArchiveProjectMediaItem[] = data.media
    .filter((item) => !item.deleted_at && item.project_id === project.id)
    .sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime())
    .map((item) => {
      const metadata = item.metadata as Record<string, unknown>;
      const isReceipt = metadata.category === "receipt";
      return {
        id: item.id,
        media_type: item.media_type,
        storage_path: item.storage_path,
        filename: item.filename,
        mime_type: item.mime_type,
        caption: item.caption,
        metadata: playbackMetadata(metadata),
        created_at: item.created_at,
        uploadedByName: item.uploaded_by ? profilesById.get(item.uploaded_by)?.name ?? null : null,
        isReceipt,
        receiptAmount: isReceipt && managerHasFinanceAccess ? receiptAmount(metadata) : null,
      };
    });
  const workerIds = new Set(sessions.map((session) => session.profileId));
  for (const assignment of data.assignments) {
    if (assignment.project_id === project.id) workerIds.add(assignment.profile_id);
  }
  const workers = [...workerIds]
    .map((workerId) => profilesById.get(workerId))
    .filter((profile): profile is NonNullable<typeof profile> => Boolean(profile))
    .sort((left, right) => left.name.localeCompare(right.name));

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <Link href="/archive" className="text-sm font-semibold text-[var(--brand-yellow)]">
          Back to Archive
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              Archived Project
            </p>
            <h1 className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{project.name}</h1>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--text-secondary)]">
              {project.address ?? "No address"} · archived {project.archived_at ? new Date(project.archived_at).toLocaleDateString() : "date not recorded"}
            </p>
          </div>
          <span
            className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em]"
            style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
          >
            Read-only history
          </span>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Workers</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{workers.length}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Sessions</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{sessions.length}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Hours</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
            {(sessions.reduce((sum, session) => sum + session.durationMinutes, 0) / 60).toFixed(1)}h
          </div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">Files</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{mediaItems.length}</div>
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Workers</h2>
        {workers.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">No workers recorded.</div>
        ) : (
          <div className="mt-4 flex flex-wrap gap-2">
            {workers.map((worker) => (
              <Link
                key={worker.id}
                href={`/team/${worker.id}`}
                className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                {worker.name} · {worker.role}
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="surface-card overflow-x-auto p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Work Sessions</h2>
        {sessions.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">No sessions recorded.</div>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <th className="pb-3 pr-3 font-semibold">Worker</th>
                <th className="pb-3 pr-3 font-semibold">Clock in</th>
                <th className="pb-3 pr-3 font-semibold">Clock out</th>
                <th className="pb-3 pr-3 font-semibold">Hours</th>
                <th className="pb-3 font-semibold">Checkout</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((session) => (
                <tr key={session.id} className="border-b border-[var(--border-subtle)]">
                  <td className="py-3 pr-3">
                    <Link href={`/team/${session.profileId}`} className="font-semibold text-[var(--text-primary)]">
                      {session.profileName}
                    </Link>
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                    {new Date(session.clockInTime).toLocaleString()}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                    {session.clockOutTime ? new Date(session.clockOutTime).toLocaleString() : "Open"}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-[var(--text-primary)]">
                    {formatDurationCompact(session.durationMinutes)}
                  </td>
                  <td className="py-3 text-[var(--text-secondary)]">{session.checkoutStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="surface-card overflow-x-auto p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Tasks</h2>
        {projectTasks.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">No tasks recorded.</div>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <th className="pb-3 pr-3 font-semibold">Task</th>
                <th className="pb-3 pr-3 font-semibold">Status</th>
                <th className="pb-3 pr-3 font-semibold">Assigned</th>
                <th className="pb-3 pr-3 font-semibold">Completed by</th>
                <th className="pb-3 font-semibold">Completed</th>
              </tr>
            </thead>
            <tbody>
              {projectTasks.map((task) => {
                const audit = getTaskCompletionAudit(task);
                const completedById = task.completed_by ?? audit.completedById;
                const completedBy = completedById ? profilesById.get(completedById)?.name ?? "Unknown" : "Not completed";
                return (
                  <tr key={task.id} className="border-b border-[var(--border-subtle)]">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-[var(--text-primary)]">{task.title}</div>
                      {task.description ? (
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{task.description}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">{task.status}</td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">
                      {task.assigned_to ? profilesById.get(task.assigned_to)?.name ?? "Unknown" : "Unassigned"}
                    </td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">{completedBy}</td>
                    <td className="py-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      {task.completed_at ? new Date(task.completed_at).toLocaleString() : "Not completed"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">Media, Checkout Proof, PDFs, Receipts</h2>
        <div className="mt-4">
          <ArchiveProjectMediaList
            items={mediaItems}
            hasFinanceAccess={managerHasFinanceAccess}
          />
        </div>
      </section>
    </div>
  );
}
