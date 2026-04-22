import type { Media, Profile, Project, Task } from "@/types/database";
import type { TaskAttachmentRef } from "@/lib/task-attachments";

export interface WorkerGeoPoint {
  lat: number;
  lng: number;
}

export interface WorkerGpsCheck {
  action: "clock_in" | "clock_out";
  projectId: string;
  projectName: string;
  position: WorkerGeoPoint;
  site: WorkerGeoPoint | null;
  radiusMeters: number;
  distanceMeters: number | null;
  accuracy: number;
  withinFence: boolean | null;
  capturedAt: string;
}

export interface WorkerProject extends Project {
  assignedAt: string | null;
  site: WorkerGeoPoint | null;
  gps_radius_m?: number | null;
}

export interface WorkerTaskItem extends Task {
  projectName: string | null;
  attachments?: TaskAttachmentRef[];
}

export interface WorkerMediaItem extends Media {
  projectName: string | null;
}

export interface WorkerSession {
  id: string;
  projectId: string;
  projectName: string;
  clockInEventId: string;
  clockOutEventId: string | null;
  clockInTime: string;
  clockOutTime: string | null;
  durationMinutes: number;
  checkoutStatus: "not_required" | "pending" | "uploaded" | "verified";
}

export interface WorkerClockState {
  isClockedIn: boolean;
  clockInTime: string | null;
  currentProjectId: string | null;
  currentProjectName: string | null;
  openEventId: string | null;
  pendingCheckoutEventId: string | null;
  pendingCheckoutProjectId: string | null;
  pendingCheckoutProjectName: string | null;
}

export interface WorkerSummary {
  todayMinutes: number;
  weekMinutes: number;
  totalSessions: number;
}

export interface WorkerAdjustmentItem {
  id: string;
  projectId: string;
  projectName: string | null;
  eventTime: string;
  minutes: number;
  reason: string;
}

export interface WorkerShellData {
  profile: Profile;
  projects: WorkerProject[];
  tasks: WorkerTaskItem[];
  media: WorkerMediaItem[];
  sessions: WorkerSession[];
  clockState: WorkerClockState;
  summary: WorkerSummary;
  adjustments: WorkerAdjustmentItem[];
}
