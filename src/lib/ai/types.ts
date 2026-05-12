import type {
  DailyReport,
  Media,
  Organization,
  Profile,
  Project,
  Task,
  TimeEvent,
} from "@/types/database";

export interface AiWorkspaceData {
  manager: Profile;
  org: Organization;
  projects: Project[];
  profiles: Profile[];
  tasks: Task[];
  timeEvents: TimeEvent[];
  media: Media[];
  dailyReports: DailyReport[];
}

export interface DailyReportInput {
  reportDate: string;
  projectId: string | null;
  projectName: string;
  workerNames: string[];
  hoursWorked: number;
  photosTaken: number;
  eventCount: number;
  completedTasks: string[];
  openTasks: string[];
  mediaCaptions: string[];
}

export interface GeneratedDailyReport {
  headline: string;
  summary: string;
  highlights: string[];
  risks: string[];
  nextActions: string[];
  laborSignal: string;
  deliverySignal: string;
  confidence: number;
  source: "anthropic" | "fallback";
}

export interface PhotoAnalysisInput {
  mediaId: string;
  mediaType: string;
  filename: string;
  caption: string;
  isCheckout: boolean;
  projectName: string;
  createdAt: string;
  relatedTasks: string[];
}

export interface PhotoAnalysisResult {
  summary: string;
  progressObservation: string;
  safetyFlags: string[];
  qualityFlags: string[];
  followUps: string[];
  tags: string[];
  confidence: number;
  source: "anthropic" | "fallback";
}

export interface SnapshotProject {
  id: string;
  name: string;
  status: string;
  onSiteWorkerCount: number;
  openTaskCount: number;
  weekMinutes: number;
}

export interface SnapshotWorker {
  id: string;
  name: string;
  role: string;
  projectName: string | null;
  currentSessionMinutes: number | null;
}

export interface SnapshotReport {
  id: string;
  projectName: string;
  reportDate: string;
  summary: string | null;
}

export interface AssistantSnapshot {
  orgName: string;
  onSiteCount: number;
  activeProjectCount: number;
  openTaskCount: number;
  hasFinanceAccess: boolean;
  unpaidHours: number;
  unpaidAmount: number;
  projects: SnapshotProject[];
  liveWorkers: SnapshotWorker[];
  recentReports: SnapshotReport[];
}

export interface AssistantLink {
  label: string;
  href: string;
}

export interface AssistantResult {
  answer: string;
  bullets: string[];
  links: AssistantLink[];
  confidence: number;
  source: "anthropic" | "fallback";
}

export type VoiceCommandIntent = "navigate" | "report" | "assistant" | "unknown";

export interface VoiceCommandResult {
  transcript: string;
  normalized: string;
  intent: VoiceCommandIntent;
  answer: string;
  actionLabel: string | null;
  route: string | null;
  confidence: number;
  source: "anthropic" | "fallback";
}

export interface AiReportCard {
  id: string;
  reportDate: string;
  projectName: string;
  summary: string | null;
  hoursWorked: number | null;
  tasksCompleted: number;
  photosTaken: number;
}

export interface AiMediaCard {
  id: string;
  createdAt: string;
  projectName: string;
  filename: string;
  caption: string | null;
  mediaType: string;
  isCheckout: boolean;
  existingAnalysis: PhotoAnalysisResult | null;
}
