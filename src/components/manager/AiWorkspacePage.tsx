"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/worker-utils";
import { useVoice } from "@/lib/hooks/useVoice";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import type {
  AiMediaCard,
  AiReportCard,
  AssistantResult,
  GeneratedDailyReport,
  PhotoAnalysisResult,
  VoiceCommandResult,
} from "@/lib/ai/types";

export function AiWorkspacePage({
  projects,
  reports,
  media,
  defaultDate,
  stats,
  hasAnthropic,
  hasAnalysisPersistence,
}: {
  projects: Array<{ id: string; name: string }>;
  reports: AiReportCard[];
  media: AiMediaCard[];
  defaultDate: string;
  stats: {
    reportsCount: number;
    analyzedMediaCount: number;
    pendingMediaCount: number;
    recentUploadsCount: number;
  };
  hasAnthropic: boolean;
  hasAnalysisPersistence: boolean;
}) {
  const router = useRouter();
  const voice = useVoice();
  const { t } = useTranslation();
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [reportDate, setReportDate] = useState(defaultDate);
  const [projectId, setProjectId] = useState("");
  const [generatedReport, setGeneratedReport] = useState<GeneratedDailyReport | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState(media[0]?.id ?? "");
  const [analysisByMediaId, setAnalysisByMediaId] = useState<
    Record<string, PhotoAnalysisResult>
  >({});
  const [voiceInput, setVoiceInput] = useState("");
  const [voiceResult, setVoiceResult] = useState<VoiceCommandResult | null>(null);
  const [assistantQuestion, setAssistantQuestion] = useState("");
  const [assistantResult, setAssistantResult] = useState<AssistantResult | null>(null);

  const selectedMedia = useMemo(
    () => media.find((item) => item.id === selectedMediaId) ?? null,
    [media, selectedMediaId],
  );
  const resolvedVoiceInput = voiceInput || voice.transcript;
  const analysis =
    (selectedMedia ? analysisByMediaId[selectedMedia.id] : null) ??
    selectedMedia?.existingAnalysis ??
    null;

  async function handleGenerateReport(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("report");
    setMessage("");

    const response = await fetch("/api/ai/daily-report", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        projectId: projectId || null,
        reportDate,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      report?: GeneratedDailyReport;
    };

    if (!response.ok || !result.report) {
      setMessage(result.error ?? t("ai.reportFailed"));
      setBusyKey(null);
      return;
    }

    setGeneratedReport(result.report);
    setBusyKey(null);
    setMessage(t("ai.reportGenerated"));
    router.refresh();
  }

  async function handleAnalyzeMedia() {
    if (!selectedMediaId) {
      return;
    }

    setBusyKey("media");
    setMessage("");

    const response = await fetch("/api/ai/photo-analysis", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        mediaId: selectedMediaId,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      analysis?: PhotoAnalysisResult;
      persisted?: boolean;
    };

    if (!response.ok || !result.analysis) {
      setMessage(result.error ?? t("ai.mediaAnalysisFailed"));
      setBusyKey(null);
      return;
    }

    setAnalysisByMediaId((current) => ({
      ...current,
      [selectedMediaId]: result.analysis as PhotoAnalysisResult,
    }));
    setBusyKey(null);
    setMessage(
      result.persisted
        ? t("ai.mediaAnalysisSaved")
        : t("ai.mediaAnalysisDone"),
    );

    if (result.persisted) {
      router.refresh();
    }
  }

  async function handleInterpretVoice(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("voice");
    setMessage("");

    const response = await fetch("/api/ai/voice-command", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transcript: resolvedVoiceInput,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      command?: VoiceCommandResult;
    };

    if (!response.ok || !result.command) {
      setMessage(result.error ?? t("ai.voiceFailed"));
      setBusyKey(null);
      return;
    }

    setVoiceResult(result.command);
    setBusyKey(null);
  }

  async function handleAskAssistant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusyKey("assistant");
    setMessage("");

    const response = await fetch("/api/ai/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: assistantQuestion,
      }),
    });
    const result = (await response.json()) as {
      error?: string;
      assistant?: AssistantResult;
    };

    if (!response.ok || !result.assistant) {
      setMessage(result.error ?? t("ai.assistantFailed"));
      setBusyKey(null);
      return;
    }

    setAssistantResult(result.assistant);
    setBusyKey(null);
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--text-muted)]">
          {t("ai.title")}
        </p>
        <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
          {t("ai.subtitle")}
        </h1>
        <p className="max-w-[66ch] text-sm leading-6 text-[var(--text-secondary)]">
          {t("ai.description")}
        </p>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("ai.reports")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{stats.reportsCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("ai.savedDailyReports")}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("ai.analyzedMedia")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{stats.analyzedMediaCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("ai.uploadsWithAnalysis")}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("ai.pendingReview")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{stats.pendingMediaCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">{t("ai.uploadsWithoutAnalysis")}</div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("ai.recentUploads")}</div>
          <div className="mt-2 text-[28px] font-bold text-[var(--text-primary)]">{stats.recentUploadsCount}</div>
          <div className="mt-1 text-sm text-[var(--text-secondary)]">
            {hasAnthropic ? t("ai.anthropicReady") : t("ai.fallbackActive")}
          </div>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("ai.dailyReports")}</h2>
            <div className="text-xs text-[var(--text-secondary)]">
              {t("ai.savedTo")}
            </div>
          </div>
          <form className="mt-4 grid gap-3" onSubmit={handleGenerateReport}>
            <select
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              <option value="">{t("ai.allProjects")}</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            <DateField
              value={reportDate}
              onChange={(event) => setReportDate(event.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={busyKey === "report"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: busyKey === "report" ? "var(--border-default)" : "var(--brand-yellow)",
                color: busyKey === "report" ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busyKey === "report" ? t("ai.generating") : t("ai.generateReport")}
            </button>
          </form>

          {generatedReport ? (
            <div className="mt-5 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <div className="text-sm font-semibold text-[var(--text-primary)]">
                {generatedReport.headline}
              </div>
              <p className="mt-3 text-sm leading-6 text-[var(--text-secondary)]">
                {generatedReport.summary}
              </p>
              <div className="mt-4 space-y-2">
                {generatedReport.highlights.map((item) => (
                  <div key={item} className="text-sm text-[var(--text-primary)]">
                    {item}
                  </div>
                ))}
              </div>
              {generatedReport.risks.length > 0 ? (
                <div className="mt-4 space-y-2">
                  {generatedReport.risks.map((item) => (
                    <div key={item} className="text-sm text-[var(--red)]">
                      {item}
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="mt-5 space-y-3">
            {reports.slice(0, 5).map((report) => (
              <div
                key={report.id}
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-[var(--text-primary)]">
                      {report.projectName}
                    </div>
                    <div className="mt-1 text-xs text-[var(--text-secondary)]">{report.reportDate}</div>
                  </div>
                  <div className="text-xs text-[var(--brand-yellow)]">
                    {report.hoursWorked?.toFixed(2) ?? "0.00"}h
                  </div>
                </div>
                {report.summary ? (
                  <p className="mt-3 text-sm text-[var(--text-secondary)]">{report.summary}</p>
                ) : null}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("ai.photoAnalysis")}</h2>
            <div className="text-xs text-[var(--text-secondary)]">
              {hasAnalysisPersistence ? t("ai.writesBack") : t("ai.sessionOnly")}
            </div>
          </div>
          <div className="mt-4 grid gap-3">
            <select
              value={selectedMediaId}
              onChange={(event) => setSelectedMediaId(event.target.value)}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            >
              {media.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.projectName} • {item.filename}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => void handleAnalyzeMedia()}
              disabled={!selectedMedia || busyKey === "media"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background: !selectedMedia || busyKey === "media" ? "var(--border-default)" : "var(--brand-yellow)",
                color: !selectedMedia || busyKey === "media" ? "var(--text-muted)" : "var(--text-inverse)",
              }}
            >
              {busyKey === "media" ? t("ai.analyzing") : t("ai.analyzeSelected")}
            </button>
          </div>

          {selectedMedia ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
              <div className="text-sm font-semibold text-[var(--text-primary)]">{selectedMedia.filename}</div>
              <div className="mt-1 text-xs text-[var(--text-secondary)]">
                {selectedMedia.projectName} • {formatDateTime(selectedMedia.createdAt)}
              </div>
              {selectedMedia.caption ? (
                <p className="mt-3 text-sm text-[var(--text-secondary)]">{selectedMedia.caption}</p>
              ) : null}
            </div>
          ) : null}

          {analysis ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <p className="text-sm leading-6 text-[var(--text-secondary)]">{analysis.summary}</p>
              <div className="mt-4 text-sm text-[var(--text-primary)]">{analysis.progressObservation}</div>
              <div className="mt-4 flex flex-wrap gap-2">
                {analysis.tags.map((tag) => (
                  <span
                    key={tag}
                    className="rounded-[var(--radius-pill)] px-2 py-1 text-[10px] font-semibold uppercase tracking-[0.14em]"
                    style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
              <div className="mt-4 space-y-2">
                {(analysis.safetyFlags.length > 0 ? analysis.safetyFlags : [t("ai.noSafetyFlags")]).map((item) => (
                  <div key={item} className="text-sm text-[var(--text-primary)]">
                    {item}
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr_1fr]">
        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("ai.voiceCommands")}</h2>
            <div className="flex flex-wrap gap-2">
              {voice.supported ? (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      if (voice.listening) {
                        voice.stop();
                      } else {
                        voice.start();
                      }
                    }}
                    className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {voice.listening ? t("ai.stopListening") : t("ai.startListening")}
                  </button>
                  <button
                    type="button"
                    onClick={voice.reset}
                    className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {t("ai.clear")}
                  </button>
                </>
              ) : (
                <div className="text-xs text-[var(--text-secondary)]">{t("ai.typeCommands")}</div>
              )}
            </div>
          </div>

          <form className="mt-4 grid gap-3" onSubmit={handleInterpretVoice}>
            <TextInputWithVoice
              multiline
              value={resolvedVoiceInput}
              onChange={(event) => setVoiceInput(event.target.value)}
              placeholder={t("ai.voicePlaceholder")}
              className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            {voice.interimTranscript ? (
              <div className="text-xs text-[var(--text-secondary)]">
                {t("ai.listening")} {voice.interimTranscript}
              </div>
            ) : null}
            {voice.error ? <div className="text-xs text-[var(--red)]">{voice.error}</div> : null}
            <button
              type="submit"
              disabled={!resolvedVoiceInput.trim() || busyKey === "voice"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background:
                  !resolvedVoiceInput.trim() || busyKey === "voice"
                    ? "var(--border-default)"
                    : "var(--brand-yellow)",
                color:
                  !resolvedVoiceInput.trim() || busyKey === "voice"
                    ? "var(--text-muted)"
                    : "var(--text-inverse)",
              }}
            >
              {busyKey === "voice" ? t("ai.interpreting") : t("ai.interpretCommand")}
            </button>
          </form>

          {voiceResult ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <div className="text-xs uppercase tracking-[0.14em] text-[var(--text-muted)]">
                {voiceResult.intent}
              </div>
              <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">{voiceResult.answer}</p>
              {voiceResult.route && voiceResult.actionLabel ? (
                <button
                  type="button"
                  onClick={() => router.push(voiceResult.route as string)}
                  className="mt-4 rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
                  style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
                >
                  {voiceResult.actionLabel}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("ai.managerAssistant")}</h2>
            <div className="text-xs text-[var(--text-secondary)]">
              {hasAnthropic ? t("ai.anthropicEnabled") : t("ai.smartFallback")}
            </div>
          </div>

          <form className="mt-4 grid gap-3" onSubmit={handleAskAssistant}>
            <TextInputWithVoice
              multiline
              value={assistantQuestion}
              onChange={(event) => setAssistantQuestion(event.target.value)}
              placeholder={t("ai.assistantPlaceholder")}
              className="min-h-[110px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
            />
            <button
              type="submit"
              disabled={!assistantQuestion.trim() || busyKey === "assistant"}
              className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
              style={{
                background:
                  !assistantQuestion.trim() || busyKey === "assistant"
                    ? "var(--border-default)"
                    : "var(--brand-yellow)",
                color:
                  !assistantQuestion.trim() || busyKey === "assistant"
                    ? "var(--text-muted)"
                    : "var(--text-inverse)",
              }}
            >
              {busyKey === "assistant" ? t("ai.thinking") : t("ai.askAssistant")}
            </button>
          </form>

          {assistantResult ? (
            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
              <p className="text-sm leading-6 text-[var(--text-secondary)]">{assistantResult.answer}</p>
              <div className="mt-4 space-y-2">
                {assistantResult.bullets.map((item) => (
                  <div key={item} className="text-sm text-[var(--text-primary)]">
                    {item}
                  </div>
                ))}
              </div>
              {assistantResult.links.length > 0 ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {assistantResult.links.map((link) => (
                    <button
                      key={link.href}
                      type="button"
                      onClick={() => router.push(link.href)}
                      className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                      style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                    >
                      {link.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </section>

      <section className="rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("ai.recentEvidence")}</h2>
          <Link href="/timeline" className="text-sm font-semibold text-[var(--brand-yellow)]">
            {t("ai.openTimeline")}
          </Link>
        </div>
        <div className="mt-4 space-y-3">
          {media.slice(0, 6).map((item) => (
            <div
              key={item.id}
              className="rounded-[var(--radius-md)] border border-[var(--border-default)] p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-[var(--text-primary)]">{item.filename}</div>
                  <div className="mt-1 text-xs text-[var(--text-secondary)]">
                    {item.projectName} • {formatDateTime(item.createdAt)}
                  </div>
                </div>
                <div className="text-xs text-[var(--brand-yellow)]">
                  {item.existingAnalysis ? t("ai.analyzed") : t("ai.pending")}
                </div>
              </div>
              {item.caption ? (
                <p className="mt-3 text-sm text-[var(--text-secondary)]">{item.caption}</p>
              ) : null}
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}
