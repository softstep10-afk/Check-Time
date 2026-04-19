import type { DailyReport, Media, Profile, Project, ProjectAssignment, Task, TimeEvent } from "@/types/database";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type { WorkerMediaItem, WorkerShellData, WorkerTaskItem } from "@/lib/worker-types";
import {
  buildWorkerSessions,
  deriveClockState,
  deriveWorkerSummary,
  enrichProjects,
} from "@/lib/worker-utils";

const now = new Date();

function isoOffset(hours: number): string {
  return new Date(now.getTime() + hours * 60 * 60 * 1000).toISOString();
}

function isoOffsetMinutes(minutes: number): string {
  return new Date(now.getTime() + minutes * 60 * 1000).toISOString();
}

const orgId = "00000000-0000-0000-0000-000000000001";
const managerId = "00000000-0000-0000-0000-000000000010";
const workerId = "00000000-0000-0000-0000-000000000011";
const supervisorId = "00000000-0000-0000-0000-000000000012";
const projectOneId = "00000000-0000-0000-0000-000000000021";
const projectTwoId = "00000000-0000-0000-0000-000000000022";

function makeProfile(overrides: Partial<Profile> & Pick<Profile, "id" | "name" | "role">): Profile {
  const { id, name, role, ...rest } = overrides;

  return {
    id,
    org_id: orgId,
    name,
    role,
    pin_hash: null,
    color: "#BFA234",
    is_active: true,
    require_video: true,
    hourly_rate: 34,
    language: "en",
    settings: {},
    last_clock_in: null,
    current_project: null,
    deleted_at: null,
    created_at: isoOffset(-24 * 14),
    updated_at: isoOffset(-2),
    ...rest,
  };
}

function makeProject(overrides: Partial<Project> & Pick<Project, "id" | "name">): Project {
  const { id, name, ...rest } = overrides;

  return {
    id,
    org_id: orgId,
    name,
    address: null,
    notes: null,
    status: "active",
    rate: 38,
    site_point: null,
    radius_m: 175,
    start_date: null,
    end_date: null,
    settings: {},
    deleted_at: null,
    created_at: isoOffset(-24 * 30),
    updated_at: isoOffset(-3),
    ...rest,
  };
}

const previewManager = makeProfile({
  id: managerId,
  name: "Preview Owner",
  role: "owner",
  require_video: false,
  hourly_rate: 52,
});

const previewWorker = makeProfile({
  id: workerId,
  name: "Preview Worker",
  role: "worker",
  current_project: projectOneId,
  last_clock_in: isoOffsetMinutes(-95),
  hourly_rate: 34,
});

const previewSupervisor = makeProfile({
  id: supervisorId,
  name: "Preview Supervisor",
  role: "supervisor",
  current_project: null,
  last_clock_in: isoOffset(-5),
  hourly_rate: 41,
});

const previewProjects: Project[] = [
  makeProject({
    id: projectOneId,
    name: "5th Ave Tower",
    address: "145 5th Ave, San Francisco, CA",
    notes: "Exterior framing and mechanical rough-in.",
    rate: 42,
    radius_m: 150,
    site_point: "SRID=4326;POINT(-122.4013 37.7889)",
    start_date: "2026-03-01",
    end_date: "2026-06-15",
  }),
  makeProject({
    id: projectTwoId,
    name: "Oak Street Renovation",
    address: "80 Oak St, San Francisco, CA",
    notes: "Interior finish pass and punch list.",
    rate: 39,
    radius_m: 180,
    site_point: "SRID=4326;POINT(-122.4215 37.7751)",
    start_date: "2026-04-10",
    end_date: "2026-05-01",
  }),
];

const previewAssignments: ProjectAssignment[] = [
  {
    id: "00000000-0000-0000-0000-000000000031",
    org_id: orgId,
    project_id: projectOneId,
    profile_id: workerId,
    assigned_at: isoOffset(-24 * 6),
  },
  {
    id: "00000000-0000-0000-0000-000000000032",
    org_id: orgId,
    project_id: projectTwoId,
    profile_id: supervisorId,
    assigned_at: isoOffset(-24 * 4),
  },
];

const previewTasks: Task[] = [
  {
    id: "00000000-0000-0000-0000-000000000041",
    org_id: orgId,
    project_id: projectOneId,
    assigned_to: workerId,
    assigned_by: managerId,
    title: "Stage lobby glass delivery",
    description: "Verify placement area and send one progress photo before noon.",
    priority: "high",
    status: "in_progress",
    due_date: now.toISOString().slice(0, 10),
    completed_at: null,
    completed_by: null,
    metadata: {},
    deleted_at: null,
    created_at: isoOffset(-10),
    updated_at: isoOffset(-2),
  },
  {
    id: "00000000-0000-0000-0000-000000000042",
    org_id: orgId,
    project_id: projectTwoId,
    assigned_to: supervisorId,
    assigned_by: managerId,
    title: "Close paint punch list",
    description: "Wrap hallway touchups and verify punch list photos.",
    priority: "medium",
    status: "done",
    due_date: now.toISOString().slice(0, 10),
    completed_at: isoOffset(-3),
    completed_by: supervisorId,
    metadata: {},
    deleted_at: null,
    created_at: isoOffset(-18),
    updated_at: isoOffset(-3),
  },
  {
    id: "00000000-0000-0000-0000-000000000043",
    org_id: orgId,
    project_id: projectOneId,
    assigned_to: null,
    assigned_by: managerId,
    title: "Check temporary handrail gap",
    description: "Safety review before the next concrete cart comes through.",
    priority: "urgent",
    status: "pending",
    due_date: now.toISOString().slice(0, 10),
    completed_at: null,
    completed_by: null,
    metadata: {},
    deleted_at: null,
    created_at: isoOffset(-4),
    updated_at: isoOffset(-4),
  },
];

const previewTimeEvents: TimeEvent[] = [
  {
    id: "00000000-0000-0000-0000-000000000051",
    org_id: orgId,
    profile_id: workerId,
    project_id: projectOneId,
    event_type: "clock_in",
    event_time: isoOffsetMinutes(-95),
    server_time: isoOffsetMinutes(-95),
    gps_point: "SRID=4326;POINT(-122.4013 37.7889)",
    gps_accuracy_m: 12,
    gps_source: "preview",
    adjusts_event_id: null,
    adjust_reason: null,
    adjusted_by: null,
    video_status: "not_required",
    video_storage_path: null,
    notes: null,
    metadata: { preview: true },
    created_at: isoOffsetMinutes(-95),
  },
  {
    id: "00000000-0000-0000-0000-000000000052",
    org_id: orgId,
    profile_id: supervisorId,
    project_id: projectTwoId,
    event_type: "clock_in",
    event_time: isoOffset(-8),
    server_time: isoOffset(-8),
    gps_point: "SRID=4326;POINT(-122.4215 37.7751)",
    gps_accuracy_m: 10,
    gps_source: "preview",
    adjusts_event_id: null,
    adjust_reason: null,
    adjusted_by: null,
    video_status: "not_required",
    video_storage_path: null,
    notes: null,
    metadata: { preview: true },
    created_at: isoOffset(-8),
  },
  {
    id: "00000000-0000-0000-0000-000000000053",
    org_id: orgId,
    profile_id: supervisorId,
    project_id: projectTwoId,
    event_type: "clock_out",
    event_time: isoOffset(-5),
    server_time: isoOffset(-5),
    gps_point: "SRID=4326;POINT(-122.4215 37.7751)",
    gps_accuracy_m: 10,
    gps_source: "preview",
    adjusts_event_id: null,
    adjust_reason: null,
    adjusted_by: null,
    video_status: "uploaded",
    video_storage_path: "media/preview-checkout.mp4",
    notes: "Finish pass complete.",
    metadata: { preview: true },
    created_at: isoOffset(-5),
  },
];

const previewMedia: Media[] = [
  {
    id: "00000000-0000-0000-0000-000000000061",
    org_id: orgId,
    project_id: projectOneId,
    uploaded_by: workerId,
    media_type: "photo",
    storage_path: "preview/5th-ave/glass-delivery.jpg",
    filename: "glass-delivery.jpg",
    file_size: 320000,
    mime_type: "image/jpeg",
    caption: "Lobby staging area cleared and ready for delivery.",
    is_checkout: false,
    time_event_id: null,
    ai_analysis: {
      summary: "The note suggests staging prep for an incoming delivery.",
      progressObservation: "Material handling prep appears to be the main work phase.",
      safetyFlags: [],
      qualityFlags: [],
      followUps: ["Confirm the final delivery window with the crew."],
      tags: ["delivery", "staging"],
      confidence: 0.58,
      source: "fallback",
    },
    metadata: { preview: true },
    deleted_at: null,
    created_at: isoOffsetMinutes(-45),
  },
  {
    id: "00000000-0000-0000-0000-000000000062",
    org_id: orgId,
    project_id: projectTwoId,
    uploaded_by: supervisorId,
    media_type: "video",
    storage_path: "preview/oak-street/walkthrough.mp4",
    filename: "walkthrough.mp4",
    file_size: 2400000,
    mime_type: "video/mp4",
    caption: "Checkout walkthrough after the punch list pass.",
    is_checkout: true,
    time_event_id: "00000000-0000-0000-0000-000000000053",
    ai_analysis: null,
    metadata: { preview: true },
    deleted_at: null,
    created_at: isoOffset(-5),
  },
];

const previewPayrollRuns = [
  {
    id: "00000000-0000-0000-0000-000000000071",
    org_id: orgId,
    run_by: managerId,
    period_start: new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    period_end: new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
    status: "confirmed" as const,
    total_hours: 74.5,
    total_amount: 2812.5,
    notes: "Preview payroll snapshot.",
    metadata: { preview: true },
    created_at: isoOffset(-24 * 6),
    confirmed_at: isoOffset(-24 * 6),
  },
];

const previewPayrollClosures = [
  {
    id: "00000000-0000-0000-0000-000000000081",
    org_id: orgId,
    payroll_run_id: "00000000-0000-0000-0000-000000000071",
    profile_id: supervisorId,
    closed_through: isoOffset(-24 * 7),
    created_at: isoOffset(-24 * 6),
  },
];

export function buildPreviewManagerWorkspaceData(): ManagerWorkspaceData {
  return {
    manager: previewManager,
    org: {
      id: orgId,
      name: "Preview Construction",
      slug: "preview-construction",
      settings: { preview: true },
      created_at: isoOffset(-24 * 40),
      updated_at: isoOffset(-1),
    },
    profiles: [previewWorker, previewSupervisor],
    projects: previewProjects,
    assignments: previewAssignments,
    tasks: previewTasks,
    timeEvents: previewTimeEvents,
    media: previewMedia,
    payrollRuns: previewPayrollRuns,
    payrollClosures: previewPayrollClosures,
  };
}

export function buildPreviewDailyReports(): DailyReport[] {
  return [
    {
      id: "00000000-0000-0000-0000-000000000091",
      org_id: orgId,
      project_id: projectOneId,
      profile_id: null,
      report_date: now.toISOString().slice(0, 10),
      summary: "5th Ave Tower logged active staging work, one live crew member, and one urgent safety follow-up.",
      hours_worked: 1.58,
      tasks_completed: 0,
      photos_taken: 1,
      ai_insights: {
        headline: "5th Ave Tower - Preview",
        source: "fallback",
      },
      event_ids: ["00000000-0000-0000-0000-000000000051"],
      media_ids: ["00000000-0000-0000-0000-000000000061"],
      metadata: { preview: true },
      created_at: isoOffsetMinutes(-20),
    },
  ];
}

export function buildPreviewWorkerShellData(): WorkerShellData {
  const profile = previewWorker;
  const rawProjects = previewProjects.filter((project) => project.id === projectOneId);
  const assignedAtByProjectId = new Map<string, string | null>([[projectOneId, isoOffset(-24 * 6)]]);
  const projects = enrichProjects(rawProjects, assignedAtByProjectId);
  const mediaEntries = previewMedia
    .filter((item) => item.uploaded_by === workerId)
    .map((entry) => ({
      ...entry,
      projectName: projects.find((project) => project.id === entry.project_id)?.name ?? null,
    })) as WorkerMediaItem[];
  const tasks = previewTasks
    .filter((task) => task.assigned_to === workerId)
    .map((task) => ({
      ...task,
      projectName: projects.find((project) => project.id === task.project_id)?.name ?? null,
    })) as WorkerTaskItem[];
  const sessions = buildWorkerSessions(
    previewTimeEvents.filter((event) => event.profile_id === workerId),
    projects,
    mediaEntries,
  );
  const clockState = deriveClockState(sessions);
  const summary = deriveWorkerSummary(sessions);

  return {
    profile,
    projects,
    tasks,
    media: mediaEntries,
    sessions,
    clockState,
    summary,
  };
}
