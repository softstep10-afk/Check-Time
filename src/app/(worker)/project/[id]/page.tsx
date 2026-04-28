import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  fetchTaskAttachments,
  getAttachmentMediaIds,
  type TaskAttachmentRef,
} from "@/lib/task-attachments";
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
  if (!user) redirect("/login");

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
  if (!project) notFound();

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
  const { data: rawMedia } = await supabase
    .from("media")
    .select("id, filename, mime_type, media_type, storage_path, metadata, created_at")
    .eq("project_id", id)
    .is("deleted_at", null)
    .order("created_at", { ascending: false });
  const projectMedia: TaskAttachmentRef[] = (rawMedia ?? [])
    .filter((m) => {
      const meta = (m as unknown as Media).metadata as Record<string, unknown> | null;
      return meta?.kind === "project_media";
    })
    .map((m) => ({
      id: m.id,
      filename: m.filename,
      mime_type: m.mime_type,
      media_type: m.media_type,
      storage_path: m.storage_path,
    }));
  const projectReceipts = (rawMedia ?? [])
    .filter((m) => {
      const meta = (m as unknown as Media).metadata as Record<string, unknown> | null;
      // metadata.category="receipt" is the legacy worker upload path
      // (WorkerProjectView WorkerReceiptUpload); metadata.kind="receipt"
      // is the manager-side path (ProjectDetailPage ReceiptsSection).
      // Accept both so neither side stays invisible.
      return meta?.kind === "receipt" || meta?.category === "receipt";
    })
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
        amount:
          typeof meta?.amount === "number"
            ? meta.amount
            : typeof meta?.amount === "string"
              ? Number.parseFloat(meta.amount)
              : null,
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
    new Set((tasks ?? []).flatMap((t) => getAttachmentMediaIds(t))),
  );
  const attachmentMap = await fetchTaskAttachments(supabase, allAttachmentIds);

  const tasksWithAttachments = (tasks ?? []).map((task) => {
    const refs = getAttachmentMediaIds(task)
      .map((mid) => attachmentMap.get(mid))
      .filter((ref): ref is TaskAttachmentRef => Boolean(ref));
    return { ...task, attachments: refs.length > 0 ? refs : undefined };
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
