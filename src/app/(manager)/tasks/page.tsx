import { ManagerTasksPage } from "@/components/manager/ManagerTasksPage";
import {
  buildActiveProjectIdSet,
  getActiveOperationalProjects,
  isTaskInActiveOperations,
} from "@/lib/archive-utils";
import { getProjectsPageData } from "@/lib/manager-data";
import { getEffectiveTaskStatus } from "@/lib/task-status";
import { type TaskAttachmentRef } from "@/lib/task-attachments";
import { collectTaskReferencedMediaIds } from "@/lib/task-media-hydration";
import { getTaskCompletionAudit } from "@/lib/task-notifications";

// F5 must reflect newly assigned/completed tasks immediately.
export const revalidate = 15;

export default async function ManagerTasksRoutePage() {
  const data = await getProjectsPageData();

  const activeProjects = getActiveOperationalProjects(data.projects);
  const activeProjectIds = buildActiveProjectIdSet(data.projects);

  const projects = activeProjects
    .map((project) => ({
      id: project.id,
      name: project.name,
      status: project.status,
    }));

  const workers = data.profiles
    .filter((profile) => !profile.deleted_at && profile.is_active)
    .map((profile) => ({
      id: profile.id,
      name: profile.name,
      role: profile.role,
    }));

  const projectsById = new Map(data.projects.map((p) => [p.id, p.name]));
  const profilesById = new Map(data.profiles.map((p) => [p.id, p.name]));

  const tasks = data.tasks
    .filter((task) => isTaskInActiveOperations(task, activeProjectIds))
    .map((task) => {
      const completedById = getTaskCompletionAudit(task).completedById;
      return {
        ...task,
        status: getEffectiveTaskStatus(task),
        projectName: task.project_id ? projectsById.get(task.project_id) ?? null : null,
        assigneeName: task.assigned_to ? profilesById.get(task.assigned_to) ?? null : null,
        completedByName: completedById ? profilesById.get(completedById) ?? null : null,
      };
    });

  // Slim down the org-wide media[] to only rows referenced by task
  // metadata: manager-supplied attachments and worker completion media.
  const referencedIds = new Set(collectTaskReferencedMediaIds(tasks));
  const attachmentMedia: TaskAttachmentRef[] = data.media
    .filter((m) => referencedIds.has(m.id))
    .map((m) => ({
      id: m.id,
      filename: m.filename,
      mime_type: m.mime_type,
      media_type: m.media_type,
      storage_path: m.storage_path,
    }));

  return (
    <ManagerTasksPage
      orgId={data.manager.org_id}
      managerId={data.manager.id}
      managerName={data.manager.name}
      managerRole={data.manager.role}
      projects={projects}
      workers={workers}
      initialTasks={tasks}
      attachmentMedia={attachmentMedia}
    />
  );
}
