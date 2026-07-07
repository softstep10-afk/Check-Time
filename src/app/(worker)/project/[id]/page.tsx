import { notFound, redirect } from "next/navigation";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { buildPreviewManagerWorkspaceData } from "@/lib/preview-data";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTaskAttachments,
  getAttachmentMediaIds,
  type TaskAttachmentRef,
} from "@/lib/task-attachments";
import { getCompletionMediaIds } from "@/lib/task-notifications";
import { isReceiptVisibleToWorker } from "@/lib/worker-receipt-visibility";
import {
  splitProjectMaterialMedia,
  toMaterialMediaAttachmentRef,
} from "@/lib/materials-grouping";
import { parseMoneyAmount } from "@/lib/money-amount";
import { WorkerProjectView } from "@/components/worker/WorkerProjectView";
import type { Media, Project, Task } from "@/types/database";

export default async function WorkerProjectPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    if (!AUTH_BYPASS_ENABLED) redirect("/login");

    const preview = buildPreviewManagerWorkspaceData();
    const project = preview.projects.find(
      (item) => item.id === id && !item.deleted_at && item.status !== "archived",
    );
    const worker =
      preview.profiles.find((profile) => profile.role === "worker") ??
      preview.profiles[0];
    if (!project || !worker) notFound();

    const rawMedia = preview.media.filter(
      (item) => item.project_id === id && !item.deleted_at,
    );
    const previewMediaGroups = splitProjectMaterialMedia(rawMedia);
    const projectMedia: TaskAttachmentRef[] =
      previewMediaGroups.projectMedia.map(toMaterialMediaAttachmentRef);
    const projectReceipts = previewMediaGroups.receipts
      .map((item) => ({
        id: item.id,
        filename: item.filename,
        mime_type: item.mime_type,
        media_type: item.media_type,
        storage_path: item.storage_path,
        created_at: item.created_at,
        store_name:
          typeof item.metadata?.store_name === "string"
            ? item.metadata.store_name
            : null,
        amount: parseMoneyAmount(item.metadata?.amount, {
          mode: "parseFloat",
          missing: null,
          invalid: "parsed",
          finiteNumbers: false,
        }),
      }));
    const tasks = preview.tasks.filter(
      (task) =>
        task.project_id === id &&
        !task.deleted_at &&
        (task.assigned_to === worker.id || task.assigned_to === null),
    );

    return (
      <WorkerProjectView
        project={project}
        projectMedia={projectMedia}
        projectReceipts={projectReceipts}
        tasks={tasks}
        orgId={project.org_id}
        profileId={worker.id}
      />
    );
  }

  // Migration 00018 — visibility honors profile.project_access_mode.
  // Owners / managers should be using /projects/<id> (their own surface)
  // — they get bounced to /overview by the (manager) layout normally, so
  // this route is effectively worker-only in practice.
  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<Project>();
  if (!project || project.status === "archived") notFound();

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("project_access_mode")
    .eq("id", user.id)
    .maybeSingle<{ project_access_mode: "list" | "all_active" | null }>();
  const accessMode: "list" | "all_active" =
    profileRow?.project_access_mode === "all_active" ? "all_active" : "list";

  let allowed = false;
  if (accessMode === "list") {
    const { data: assignment } = await supabase
      .from("project_assignments")
      .select("project_id")
      .eq("project_id", id)
      .eq("profile_id", user.id)
      .maybeSingle();
    allowed = Boolean(assignment);
  } else {
    if (project.status === "active") {
      const { data: exclusion, error: exclusionError } = await supabase
        .from("project_exclusions")
        .select("id")
        .eq("project_id", id)
        .eq("profile_id", user.id)
        .maybeSingle();
      // If the table doesn't exist yet (pre-migration deploy), treat as
      // "no exclusions" rather than failing closed.
      allowed = exclusionError ? true : !exclusion;
    }
  }
  if (!allowed) notFound();

  // All visible media for this project. Worker RLS already scopes this
  // to projects they're assigned to (or all-active mode minus exclusions).
  // We split client-side into project media vs receipts based on
  // metadata.kind so the worker view can render two separate sections.
  // Receipts and task attachments stay out of the "Project Media" list.
  // We also pull `uploaded_by` so receipts can be filtered to the worker's
  // own submissions — workers must not see other workers' receipts (which
  // would leak project material cost).
  const { data: rawMedia } = await supabase
    .from("media")
    .select(
      "id, filename, mime_type, media_type, storage_path, metadata, created_at, uploaded_by",
    )
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const mediaGroups = splitProjectMaterialMedia(rawMedia ?? [], {
    // Worker view shows only the worker's own receipts. Manager / owner
    // surfaces continue to see all receipts (those pages run their own
    // queries). Without this filter a worker on a shared project would
    // see every other worker's amounts and effectively the project's
    // material cost — a leak the spec calls out.
    receiptFilter: (m) =>
      isReceiptVisibleToWorker(
        m as unknown as { uploaded_by: string | null; metadata: Record<string, unknown> | null },
        user.id,
      ),
  });
  const projectMedia: TaskAttachmentRef[] =
    mediaGroups.projectMedia.map(toMaterialMediaAttachmentRef);
  const projectReceipts = mediaGroups.receipts
    .map((m) => {
      const meta = (m as unknown as Media).metadata as Record<string, unknown> | null;
      return {
        id: m.id,
        filename: m.filename,
        mime_type: m.mime_type,
        media_type: m.media_type,
        storage_path: m.storage_path,
        created_at: m.created_at,
        store_name: typeof meta?.store_name === "string" ? meta.store_name : null,
        amount: parseMoneyAmount(meta?.amount, {
          mode: "parseFloat",
          missing: null,
          invalid: "parsed",
          finiteNumbers: false,
        }),
      };
    });

  // Tasks for this project: assigned to this worker OR project-level
  // (assigned_to IS NULL) so the whole crew sees crew-wide tasks.
  const { data: tasks } = await supabase
    .from("tasks")
    .select("*")
    .eq("project_id", id)
    .is("deleted_at", null)
    .or(`assigned_to.eq.${user.id},assigned_to.is.null`)
    .order("created_at", { ascending: false })
    .returns<Task[]>();

  const allAttachmentIds = Array.from(
    new Set(
      (tasks ?? []).flatMap((t) => [
        ...getAttachmentMediaIds(t),
        ...getCompletionMediaIds(t),
      ]),
    ),
  );
  const attachmentMap = await fetchTaskAttachments(supabase, allAttachmentIds);

  const tasksWithAttachments = (tasks ?? []).map((task) => {
    const refs = getAttachmentMediaIds(task)
      .map((mid) => attachmentMap.get(mid))
      .filter((ref): ref is TaskAttachmentRef => Boolean(ref));
    const completionRefs = getCompletionMediaIds(task)
      .map((mid) => attachmentMap.get(mid))
      .filter((ref): ref is TaskAttachmentRef => Boolean(ref));
    return {
      ...task,
      attachments: refs.length > 0 ? refs : undefined,
      completionAttachments: completionRefs.length > 0 ? completionRefs : undefined,
    };
  });

  return (
    <WorkerProjectView
      project={project}
      projectMedia={projectMedia}
      projectReceipts={projectReceipts}
      tasks={tasksWithAttachments}
      orgId={project.org_id}
      profileId={user.id}
    />
  );
}
