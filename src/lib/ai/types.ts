import type {
  DailyReport,
  Media,
  Organization,
  Profile,
  Project,
  Task,
  TimeEvent,
} from "@/types/database";
import type { JarvisMemoryRule } from "@/lib/ai/jarvis-memory";

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

export interface SnapshotProjectMaterialSpecItem {
  name: string;
  quantity: string;
  unit: string;
  supplier: string;
  link: string;
  note: string;
}

export interface SnapshotProjectEstimate {
  title: string;
  status: string;
  description: string;
  clientPrice: number;
  internalCost: number;
  materialCost: number;
  margin: number;
  workItems: string[];
}

export interface SnapshotProject {
  id: string;
  name: string;
  status: string;
  address: string | null;
  notes: string | null;
  startDate: string | null;
  endDate: string | null;
  onSiteWorkerCount: number;
  openTaskCount: number;
  weekMinutes: number;
  skillTags: string[];
  openTaskTitles: string[];
  materialSpec: SnapshotProjectMaterialSpecItem[];
  estimates: SnapshotProjectEstimate[];
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

export interface SnapshotWorkerMetric {
  id: string;
  name: string;
  role: string;
  monthHours: number;
  completedTasksThisMonth: number;
  openTaskCount: number;
  currentProjectName: string | null;
  assignedProjectNames: string[];
  skills: string[];
  capabilitiesNote: string | null;
}

export interface SnapshotOpenTask {
  id: string;
  title: string;
  projectId: string | null;
  projectName: string;
  priority: string;
  dueDate: string | null;
  assignedToName: string | null;
  skillTags: string[];
}

export interface SnapshotAssignmentCandidate {
  workerId: string;
  name: string;
  role: string;
  skills: string[];
  matchedSkills: string[];
  score: number;
  reason: string;
}

export interface SnapshotAssignmentSuggestion {
  taskId: string;
  taskTitle: string;
  projectId: string | null;
  projectName: string;
  requiredSkills: string[];
  candidates: SnapshotAssignmentCandidate[];
}

export interface SnapshotMediaItem {
  id: string;
  projectId: string | null;
  projectName: string;
  uploadedByName: string | null;
  mediaType: string;
  filename: string;
  caption: string | null;
  isCheckout: boolean;
  createdAt: string;
  tags: string[];
  summary: string | null;
}

export interface SnapshotCodeReference {
  topic: string;
  summary: string;
  sourceLabel: string;
  url: string;
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
  workerMetrics: SnapshotWorkerMetric[];
  openTasks: SnapshotOpenTask[];
  assignmentSuggestions: SnapshotAssignmentSuggestion[];
  mediaIndex: SnapshotMediaItem[];
  memoryRules: JarvisMemoryRule[];
  codeReferences: SnapshotCodeReference[];
  recentReports: SnapshotReport[];
}

export interface AssistantLink {
  label: string;
  href: string;
}

export type AssistantAction =
  | {
      kind: "navigate";
      label: string;
      href: string;
    }
  | {
      kind: "create_project";
      label: string;
      payload: {
        name: string;
        address?: string | null;
        notes?: string | null;
        startDate?: string | null;
        endDate?: string | null;
      };
    };

export interface AssistantConversationTurn {
  role: "user" | "assistant";
  text: string;
}

export interface AssistantResult {
  answer: string;
  bullets: string[];
  links: AssistantLink[];
  actions?: AssistantAction[];
  confidence: number;
  source: "anthropic" | "openai" | "fallback";
  memorySaved?: JarvisMemoryRule | null;
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
