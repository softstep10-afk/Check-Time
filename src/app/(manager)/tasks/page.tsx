import { ManagerTasksPage } from "@/components/manager/ManagerTasksPage";
import { getManagerWorkspaceData } from "@/lib/manager-data";

export default async function ManagerTasksRoutePage() {
  const data = await getManagerWorkspaceData();

  const projects = data.projects
    .filter((project) => !project.deleted_at)
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
    .filter((task) => !task.deleted_at)
    .map((task) => ({
      ...task,
      projectName: task.project_id ? projectsById.get(task.project_id) ?? null : null,
      assigneeName: task.assigned_to ? profilesById.get(task.assigned_to) ?? null : null,
    }));

  return (
    <ManagerTasksPage
      orgId={data.manager.org_id}
      managerId={data.manager.id}
      projects={projects}
      workers={workers}
      initialTasks={tasks}
    />
  );
}
