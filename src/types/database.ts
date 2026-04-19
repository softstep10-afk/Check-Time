// ============================================================================
// Database types — mirrors the Supabase schema
// In production, generate these with: npx supabase gen types typescript
// ============================================================================

export type UserRole = 'worker' | 'supervisor' | 'driver' | 'subcontractor' | 'manager' | 'admin' | 'owner';
export type ProjectStatus = 'active' | 'paused' | 'completed' | 'archived';
export type TimeEventType = 'clock_in' | 'clock_out' | 'auto_out' | 'adjust' | 'break_start' | 'break_end';
export type CheckoutVideoStatus = 'not_required' | 'pending' | 'uploaded' | 'verified';
export type TaskPriority = 'low' | 'medium' | 'high' | 'urgent';
export type TaskStatus = 'pending' | 'in_progress' | 'done' | 'cancelled';
export type MediaType = 'photo' | 'video' | 'pdf' | 'document';
export type PayrollStatus = 'draft' | 'confirmed' | 'exported' | 'paid';

// ---- Core entities ----

export interface Organization {
  id: string;
  name: string;
  slug: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

export interface Profile {
  id: string;
  org_id: string;
  name: string;
  role: UserRole;
  pin_hash: string | null;
  color: string;
  is_active: boolean;
  require_video: boolean;
  hourly_rate: number | null;
  language: string;
  settings: Record<string, unknown>;
  last_clock_in: string | null;
  current_project: string | null;
  // Migration 00009 introduces the notif_mode column. Older environments
  // may not have it yet; the worker shell reads it defensively and falls
  // back to localStorage for the silent-mode toggle.
  notif_mode?: "sound" | "silent" | null;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  org_id: string;
  name: string;
  address: string | null;
  notes: string | null;
  status: ProjectStatus;
  rate: number;
  site_point: unknown | null;  // PostGIS geography
  radius_m: number;
  start_date: string | null;
  end_date: string | null;
  settings: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface ProjectAssignment {
  id: string;
  org_id: string;
  project_id: string;
  profile_id: string;
  assigned_at: string;
}

export interface TimeEvent {
  id: string;
  org_id: string;
  profile_id: string;
  project_id: string;
  event_type: TimeEventType;
  event_time: string;
  server_time: string;
  gps_point: unknown | null;
  gps_accuracy_m: number | null;
  gps_source: string | null;
  adjusts_event_id: string | null;
  adjust_reason: string | null;
  adjusted_by: string | null;
  video_status: CheckoutVideoStatus;
  video_storage_path: string | null;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface Task {
  id: string;
  org_id: string;
  project_id: string | null;
  assigned_to: string | null;
  assigned_by: string | null;
  title: string;
  description: string | null;
  priority: TaskPriority;
  status: TaskStatus;
  due_date: string | null;
  completed_at: string | null;
  completed_by: string | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface Media {
  id: string;
  org_id: string;
  project_id: string | null;
  uploaded_by: string | null;
  media_type: MediaType;
  storage_path: string;
  filename: string | null;
  file_size: number | null;
  mime_type: string | null;
  caption: string | null;
  is_checkout: boolean;
  time_event_id: string | null;
  ai_analysis: Record<string, unknown> | null;
  metadata: Record<string, unknown>;
  deleted_at: string | null;
  created_at: string;
}

export interface PayrollRun {
  id: string;
  org_id: string;
  run_by: string | null;
  period_start: string;
  period_end: string;
  status: PayrollStatus;
  total_hours: number;
  total_amount: number;
  notes: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
  confirmed_at: string | null;
}

export interface PayrollLineItem {
  id: string;
  payroll_run_id: string;
  profile_id: string;
  project_id: string | null;
  hours: number;
  rate: number;
  amount: number;
  event_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface PayrollClosure {
  id: string;
  org_id: string;
  payroll_run_id: string;
  profile_id: string;
  closed_through: string;
  created_at: string;
}

export interface DailyReport {
  id: string;
  org_id: string;
  project_id: string | null;
  profile_id: string | null;
  report_date: string;
  summary: string | null;
  hours_worked: number | null;
  tasks_completed: number;
  photos_taken: number;
  ai_insights: Record<string, unknown> | null;
  event_ids: string[];
  media_ids: string[];
  metadata: Record<string, unknown>;
  created_at: string;
}

// ---- Derived / UI types ----

export interface ClockStatus {
  isClockedIn: boolean;
  currentProject: Project | null;
  clockInTime: Date | null;
  elapsedSeconds: number;
}

export interface TimeSession {
  clockIn: TimeEvent;
  clockOut: TimeEvent | null;
  durationMinutes: number;
  project: Project;
  worker: Profile;
}

export interface PayrollSummary {
  worker: Profile;
  totalHours: number;
  rate: number;
  totalAmount: number;
  projectBreakdown: {
    project: Project;
    hours: number;
    amount: number;
  }[];
}
