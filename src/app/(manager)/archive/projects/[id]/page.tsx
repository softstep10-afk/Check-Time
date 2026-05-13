import Link from "next/link";
import { notFound } from "next/navigation";
import { X } from "lucide-react";
import {
  ArchiveProjectMediaList,
  type ArchiveProjectMediaItem,
} from "@/components/manager/ArchiveProjectMediaList";
import { isArchivedProject } from "@/lib/archive-utils";
import { hasFinanceAccess } from "@/lib/finance-access";
import { getArchivePageData } from "@/lib/manager-data";
import { buildManagerSessions } from "@/lib/manager-utils";
import { getTaskCompletionAudit } from "@/lib/task-notifications";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { createClient } from "@/lib/supabase/server";
import { getServerLocale } from "@/lib/i18n/server";
import { formatDurationCompact } from "@/lib/worker-utils";

export const revalidate = 0;

const COPY = {
  en: {
    back: "Back to Archive",
    close: "Close archived project",
    eyebrow: "Archived Project",
    noAddress: "No address",
    archived: "archived",
    noArchiveDate: "date not recorded",
    readOnly: "Read-only history",
    workers: "Workers",
    sessions: "Sessions",
    hours: "Hours",
    files: "Files",
    noWorkers: "No workers recorded.",
    workSessions: "Work Sessions",
    noSessions: "No sessions recorded.",
    worker: "Worker",
    clockIn: "Clock in",
    clockOut: "Clock out",
    checkout: "Checkout",
    open: "Open",
    tasks: "Tasks",
    noTasks: "No tasks recorded.",
    task: "Task",
    status: "Status",
    assigned: "Assigned",
    completedBy: "Completed by",
    completed: "Completed",
    unknown: "Unknown",
    notCompleted: "Not completed",
    unassigned: "Unassigned",
    mediaTitle: "Media, Checkout Proof, PDFs, Receipts",
    taskStatus: {
      pending: "Pending",
      in_progress: "In progress",
      done: "Done",
      cancelled: "Cancelled",
    } as Record<string, string>,
    checkoutStatus: {
      not_required: "Not required",
      pending: "Pending",
      uploaded: "Uploaded",
      verified: "Verified",
    } as Record<string, string>,
  },
  ru: {
    back: "Назад в архив",
    close: "Закрыть архивный проект",
    eyebrow: "Архивный проект",
    noAddress: "Адрес не указан",
    archived: "архивирован",
    noArchiveDate: "дата не записана",
    readOnly: "История только для просмотра",
    workers: "Рабочие",
    sessions: "Смены",
    hours: "Часы",
    files: "Файлы",
    noWorkers: "Рабочие не записаны.",
    workSessions: "Рабочие смены",
    noSessions: "Смены не записаны.",
    worker: "Рабочий",
    clockIn: "Начало",
    clockOut: "Конец",
    checkout: "Выход",
    open: "Открыта",
    tasks: "Задачи",
    noTasks: "Задачи не записаны.",
    task: "Задача",
    status: "Статус",
    assigned: "Назначено",
    completedBy: "Выполнил",
    completed: "Завершено",
    unknown: "Неизвестно",
    notCompleted: "Не завершено",
    unassigned: "Не назначено",
    mediaTitle: "Медиа, подтверждения выхода, PDF и чеки",
    taskStatus: {
      pending: "Ожидает",
      in_progress: "В работе",
      done: "Готово",
      cancelled: "Отменена",
    } as Record<string, string>,
    checkoutStatus: {
      not_required: "Не требуется",
      pending: "Ожидает",
      uploaded: "Загружено",
      verified: "Проверено",
    } as Record<string, string>,
  },
} as const;

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
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ returnTo?: string | string[] }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const rawReturnTo = Array.isArray(resolvedSearchParams.returnTo)
    ? resolvedSearchParams.returnTo[0]
    : resolvedSearchParams.returnTo;
  const backHref = rawReturnTo?.startsWith("/") && !rawReturnTo.startsWith("//")
    ? rawReturnTo
    : "/archive";
  const locale = await getServerLocale();
  const text = COPY[locale];
  const dateLocale = locale === "ru" ? "ru-RU" : "en-US";
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
        <Link href={backHref} className="text-sm font-semibold text-[var(--brand-yellow)]">
          {text.back}
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
              {text.eyebrow}
            </p>
            <h1 className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{project.name}</h1>
            <p className="mt-1 max-w-[72ch] text-sm leading-6 text-[var(--text-secondary)]">
              {project.address ?? text.noAddress} · {text.archived} {project.archived_at ? new Date(project.archived_at).toLocaleDateString(dateLocale) : text.noArchiveDate}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em]"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {text.readOnly}
            </span>
            <Link
              href={backHref}
              aria-label={text.close}
              title={text.close}
              className="inline-flex h-9 w-9 items-center justify-center rounded-[var(--radius-sm)] border text-[var(--text-primary)] transition hover:border-[var(--brand-yellow)] hover:text-[var(--brand-yellow)]"
              style={{ borderColor: "var(--border-default)" }}
            >
              <X size={17} />
            </Link>
          </div>
        </div>
      </section>

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.workers}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{workers.length}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.sessions}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{sessions.length}</div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.hours}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">
            {(sessions.reduce((sum, session) => sum + session.durationMinutes, 0) / 60).toFixed(1)}h
          </div>
        </div>
        <div className="surface-card p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{text.files}</div>
          <div className="mt-2 font-mono text-[28px] font-bold text-[var(--text-primary)]">{mediaItems.length}</div>
        </div>
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.workers}</h2>
        {workers.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">{text.noWorkers}</div>
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
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.workSessions}</h2>
        {sessions.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">{text.noSessions}</div>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <th className="pb-3 pr-3 font-semibold">{text.worker}</th>
                <th className="pb-3 pr-3 font-semibold">{text.clockIn}</th>
                <th className="pb-3 pr-3 font-semibold">{text.clockOut}</th>
                <th className="pb-3 pr-3 font-semibold">{text.hours}</th>
                <th className="pb-3 font-semibold">{text.checkout}</th>
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
                    {new Date(session.clockInTime).toLocaleString(dateLocale)}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                    {session.clockOutTime ? new Date(session.clockOutTime).toLocaleString(dateLocale) : text.open}
                  </td>
                  <td className="py-3 pr-3 whitespace-nowrap font-mono text-[var(--text-primary)]">
                    {formatDurationCompact(session.durationMinutes)}
                  </td>
                  <td className="py-3 text-[var(--text-secondary)]">{text.checkoutStatus[session.checkoutStatus] ?? session.checkoutStatus}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className="surface-card overflow-x-auto p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.tasks}</h2>
        {projectTasks.length === 0 ? (
          <div className="mt-4 text-sm text-[var(--text-secondary)]">{text.noTasks}</div>
        ) : (
          <table className="mt-4 w-full text-left text-sm">
            <thead>
              <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                <th className="pb-3 pr-3 font-semibold">{text.task}</th>
                <th className="pb-3 pr-3 font-semibold">{text.status}</th>
                <th className="pb-3 pr-3 font-semibold">{text.assigned}</th>
                <th className="pb-3 pr-3 font-semibold">{text.completedBy}</th>
                <th className="pb-3 font-semibold">{text.completed}</th>
              </tr>
            </thead>
            <tbody>
              {projectTasks.map((task) => {
                const audit = getTaskCompletionAudit(task);
                const effectiveStatus = getEffectiveTaskStatus(task);
                const completedById = task.completed_by ?? audit.completedById;
                const completedBy = completedById ? profilesById.get(completedById)?.name ?? text.unknown : text.notCompleted;
                return (
                  <tr key={task.id} className="border-b border-[var(--border-subtle)]">
                    <td className="py-3 pr-3">
                      <div className="font-semibold text-[var(--text-primary)]">{task.title}</div>
                      {task.description ? (
                        <div className="mt-0.5 text-xs text-[var(--text-secondary)]">{task.description}</div>
                      ) : null}
                    </td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">{text.taskStatus[effectiveStatus] ?? effectiveStatus}</td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">
                      {task.assigned_to ? profilesById.get(task.assigned_to)?.name ?? text.unknown : text.unassigned}
                    </td>
                    <td className="py-3 pr-3 text-[var(--text-secondary)]">{completedBy}</td>
                    <td className="py-3 whitespace-nowrap font-mono text-xs text-[var(--text-secondary)]">
                      {task.completed_at ? new Date(task.completed_at).toLocaleString(dateLocale) : text.notCompleted}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className="surface-card p-4">
        <h2 className="text-lg font-bold text-[var(--text-primary)]">{text.mediaTitle}</h2>
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
