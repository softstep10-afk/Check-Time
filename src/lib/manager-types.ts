import type {
  Media,
  Organization,
  PayrollClosure,
  PayrollRun,
  Profile,
  Project,
  ProjectAssignment,
  Task,
  TimeEvent,
  UserRole,
} from "@/types/database";

export interface ManagerWorkspaceData {
  manager: Profile;
  org: Organization;
  profiles: Profile[];
  projects: Project[];
  assignments: ProjectAssignment[];
  tasks: Task[];
  timeEvents: TimeEvent[];
  media: Media[];
  payrollRuns: PayrollRun[];
  payrollClosures: PayrollClosure[];
}

export interface ManagerSession {
  id: string;
  profileId: string;
  profileName: string;
  profileRole: UserRole;
  projectId: string;
  projectName: string;
  clockInEventId: string;
  clockOutEventId: string | null;
  clockInTime: string;
  clockOutTime: string | null;
  durationMinutes: number;
  checkoutStatus: "not_required" | "pending" | "uploaded" | "verified";
  isOpen: boolean;
  eventIds: string[];
}

export interface ManagerProjectSummary extends Project {
  assignedWorkerCount: number;
  onSiteWorkerCount: number;
  openTaskCount: number;
  weekMinutes: number;
  receiptTotal: number;
}

export interface ManagerProfileSummary extends Profile {
  assignedProjectIds: string[];
  assignedProjectNames: string[];
  currentProjectName: string | null;
  openTaskCount: number;
  weekMinutes: number;
  isOnSite: boolean;
  currentSessionMinutes: number | null;
}

export interface ManagerTimelineItem extends TimeEvent {
  profileName: string;
  profileRole: UserRole;
  projectName: string;
}

export interface PayrollPreviewLine {
  profileId: string;
  profileName: string;
  profileRole: UserRole;
  projectId: string;
  projectName: string;
  minutes: number;
  hours: number;
  rate: number;
  amount: number;
  sessionIds: string[];
  eventIds: string[];
}

export interface PayrollWorkerTotal {
  profileId: string;
  profileName: string;
  profileRole: UserRole;
  hours: number;
  amount: number;
  lines: PayrollPreviewLine[];
}

export interface PayrollPreview {
  periodStart: string;
  periodEnd: string;
  totalHours: number;
  totalAmount: number;
  workersCount: number;
  lineCount: number;
  lines: PayrollPreviewLine[];
  workerTotals: PayrollWorkerTotal[];
}
