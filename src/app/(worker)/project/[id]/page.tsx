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

  // Worker must be assigned to this project to view it. Owners /
  // managers should be using /projects/<id> (their own surface) — they
  // get bounced to /overview by the (manager) layout normally, so this
  // route is effectively worker-only in practice.
  const { data: assignment } = await supabase
    .from("project_assignments")
    .select("project_id")
    .eq("project_id", id)
    .eq("profile_id", user.id)
    .maybeSingle();
  if (!assignment) notFound();

  const { data: project } = await supabase
    .from("projects")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle<Project>();
  if (!project) notFound();

  // Project Media — strict filter to metadata.kind="project_media".
  // Receipts and task attachments are intentionally excluded.
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
      tasks={tasksWithAttachments}
      orgId={project.org_id}
      profileId={user.id}
    />
  );
}
