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
import type { StoreVisit } from "@/lib/store-types";
import type { WorkerGeoPoint } from "@/lib/worker-types";

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
  storeVisits: StoreVisit[];
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
  /**
   * Worker's free-form note typed in CheckoutModal, copied from
   * `time_events.metadata.checkout_note` of the closing event. Null
   * when the worker left it blank (the dominant case) or when the
   * shift is still open.
   */
  checkoutNote: string | null;
}

export interface ManagerProjectSummary extends Project {
  assignedWorkerCount: number;
  onSiteWorkerCount: number;
  openTaskCount: number;
  materialOpenTaskCount: number;
  materialUrgentTaskCount: number;
  materialAssignedTaskCount: number;
  materialSeenTaskCount: number;
  materialIndicator: "urgent" | "seen" | "assigned" | "needed" | null;
  weekMinutes: number;
  receiptTotal: number;
  lastActivityTime: string | null;
  siteCoordinates: WorkerGeoPoint | null;
  hasValidSiteCoordinates: boolean;
  recentMedia: Array<{
    id: string;
    media_type: string;
    storage_path: string;
    filename: string | null;
  }>;
  recentMediaTotal: number;
  /**
   * Number of shifts on this project where durationMinutes is in
   * [WARN_SHIFT_MINUTES, EXTREME_SHIFT_MINUTES) — amber band.
   */
  longShiftCount: number;
  /**
   * Number of shifts where durationMinutes ≥ EXTREME_SHIFT_MINUTES (24h).
   * Used to flip the project workload card into a critical/red state.
   */
  extremeShiftCount: number;
  /**
   * Single worst (longest) shift on the project, or null when none.
   * Surfaced on the workload card so the manager sees worker name +
   * duration without leaving the Overview.
   */
  longestShift: {
    workerName: string;
    durationMinutes: number;
  } | null;
}

export interface ManagerProfileSummary extends Profile {
  assignedProjectIds: string[];
  assignedProjectNames: string[];
  currentProjectName: string | null;
  openTaskCount: number;
  weekMinutes: number;
  isOnSite: boolean;
  currentSessionMinutes: number | null;
  videoUploadedToday: boolean;
  /**
   * Effective finance access for this profile, mirroring the receipt
   * branch of migration 00022's media SELECT policy:
   *   true  iff role ∈ {owner, admin}
   *         OR user_capabilities has (user_id=profile.id,
   *            capability='finance_access', granted=true).
   *
   * Callers of buildProfileSummaries() that don't pass the capability
   * set get owner/admin → true and everyone else → false, which is the
   * safe default (treat unknown as "no access").
   */
  financeAccess: boolean;
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
