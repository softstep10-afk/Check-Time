import { AiWorkspacePage } from "@/components/manager/AiWorkspacePage";
import { getAiWorkspaceData } from "@/lib/ai/data";
import {
  coercePhotoAnalysis,
  getTodayInOrgTimeZone,
} from "@/lib/ai/service";
import { resolveJarvisRuntimeConfig } from "@/lib/ai/jarvis-config";
import { getJarvisRoutingDiagnostics } from "@/lib/ai/provider-routing";

export default async function AiPage() {
  const data = await getAiWorkspaceData();
  const canViewDiagnostics = data.manager.role === "owner" || data.manager.role === "admin";
  const jarvisConfig = resolveJarvisRuntimeConfig(data.org.settings);
  const routingDiagnostics = canViewDiagnostics ? getJarvisRoutingDiagnostics() : [];
  const projectNameById = new Map(data.projects.map((project) => [project.id, project.name]));
  const reports = data.dailyReports.map((report) => ({
    id: report.id,
    reportDate: report.report_date,
    projectName: report.project_id
      ? projectNameById.get(report.project_id) ?? "Unknown project"
      : "All Projects",
    summary: report.summary,
    hoursWorked: report.hours_worked,
    tasksCompleted: report.tasks_completed,
    photosTaken: report.photos_taken,
  }));
  const media = data.media.slice(0, 24).map((item) => ({
    id: item.id,
    createdAt: item.created_at,
    projectName: item.project_id
      ? projectNameById.get(item.project_id) ?? "Unknown project"
      : "Unlinked project",
    filename: item.filename ?? item.media_type,
    caption: item.caption,
    mediaType: item.media_type,
    isCheckout: item.is_checkout,
    existingAnalysis: coercePhotoAnalysis(item.ai_analysis),
  }));
  const analyzedMediaCount = data.media.filter((item) => Boolean(coercePhotoAnalysis(item.ai_analysis))).length;

  return (
    <AiWorkspacePage
      projects={data.projects
        .filter((project) => project.status !== "archived")
        .map((project) => ({ id: project.id, name: project.name }))}
      reports={reports}
      media={media}
      defaultDate={getTodayInOrgTimeZone()}
      stats={{
        reportsCount: reports.length,
        analyzedMediaCount,
        pendingMediaCount: Math.max(0, media.length - media.filter((item) => item.existingAnalysis).length),
        recentUploadsCount: media.length,
      }}
      hasModelProvider={Boolean(
        process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
          process.env.GEMINI_API_KEY ||
          process.env.GOOGLE_AI_API_KEY ||
          process.env.OPENAI_API_KEY ||
          process.env.ANTHROPIC_API_KEY,
      )}
      hasAnalysisPersistence={Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY)}
      canViewDiagnostics={canViewDiagnostics}
      jarvisConfig={jarvisConfig}
      providerDiagnostics={canViewDiagnostics ? routingDiagnostics : []}
    />
  );
}
