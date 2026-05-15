"use client";

import Link from "next/link";
import { useMemo, useRef, useState } from "react";
import { Paperclip } from "lucide-react";
import { useRouter } from "next/navigation";
import { formatDateTime } from "@/lib/worker-utils";
import { useVoice } from "@/lib/hooks/useVoice";
import { useTranslation } from "@/lib/i18n";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { DateField } from "@/components/shared/DateField";
import { JarvisOrb } from "@/components/shared/JarvisOrb";
import type {
  AiMediaCard,
  AiReportCard,
  AssistantAction,
  AssistantLink,
  AssistantResult,
  GeneratedDailyReport,
  PhotoAnalysisResult,
  VoiceCommandResult,
} from "@/lib/ai/types";

type JarvisMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  bullets: string[];
  links: AssistantLink[];
  actions: AssistantAction[];
  source: AssistantResult["source"] | null;
};

type JarvisSettingsAttachment = {
  filename: string;
  mimeType: string | null;
  content: string | null;
  dataUrl: string | null;
};

const MAX_JARVIS_FILE_BYTES = 4_500_000;
const JARVIS_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);
const JARVIS_PDF_TYPES = new Set(["application/pdf"]);

function isTextLikeFile(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    file.type.startsWith("text/") ||
    name.endsWith(".txt") ||
    name.endsWith(".md") ||
    name.endsWith(".csv") ||
    name.endsWith(".json") ||
    name.endsWith(".log") ||
    name.endsWith(".xml")
  );
}

function isJarvisImageFile(file: File): boolean {
  return JARVIS_IMAGE_TYPES.has(file.type.toLowerCase());
}

function isJarvisPdfFile(file: File): boolean {
  return JARVIS_PDF_TYPES.has(file.type.toLowerCase()) || file.name.toLowerCase().endsWith(".pdf");
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("Unable to read file."));
    };
    reader.onerror = () => reject(reader.error ?? new Error("Unable to read file."));
    reader.readAsDataURL(file);
  });
}

export function AiWorkspacePage({
  projects,
  reports,
  media,
  defaultDate,
  stats,
  hasModelProvider,
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
  hasModelProvider: boolean;
  hasAnalysisPersistence: boolean;
}) {
  const router = useRouter();
  const voice = useVoice();
  const { t } = useTranslation();
  const assistantFileInputRef = useRef<HTMLInputElement | null>(null);
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
  const [assistantAttachments, setAssistantAttachments] = useState<JarvisSettingsAttachment[]>([]);
  const [jarvisMessages, setJarvisMessages] = useState<JarvisMessage[]>([]);

  const selectedMedia = useMemo(
    () => media.find((item) => item.id === selectedMediaId) ?? null,
    [media, selectedMediaId],
  );
  const resolvedVoiceInput = voiceInput || voice.transcript;
  const analysis =
    (selectedMedia ? analysisByMediaId[selectedMedia.id] : null) ??
    selectedMedia?.existingAnalysis ??
    null;
  const quickJarvisQuestions = useMemo(
    () => [
      t("ai.jarvisQuickMorning"),
      t("ai.jarvisQuickPayroll"),
      t("ai.jarvisQuickDispatch"),
      t("ai.jarvisQuickRisk"),
    ],
    [t],
  );
  const jarvisSettingsCards = useMemo(
    () => [
      {
        title: t("ai.settingsAccessTitle"),
        body: t("ai.settingsAccessBody"),
        status: t("ai.settingsAccessStatus"),
      },
      {
        title: t("ai.settingsActionsTitle"),
        body: t("ai.settingsActionsBody"),
        status: t("ai.settingsActionsStatus"),
      },
      {
        title: t("ai.settingsVoiceTitle"),
        body: t("ai.settingsVoiceBody"),
        status: hasModelProvider ? t("ai.realModelConnected") : t("ai.smartFallback"),
      },
      {
        title: t("ai.settingsSkillsTitle"),
        body: t("ai.settingsSkillsBody"),
        status: t("ai.settingsSkillsStatus"),
      },
    ],
    [hasModelProvider, t],
  );

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

  async function handleAssistantFiles(fileList: FileList | null) {
    if (!fileList) return;
    const next: JarvisSettingsAttachment[] = [];

    for (const file of Array.from(fileList).slice(0, 5)) {
      let content: string | null = null;
      let dataUrl: string | null = null;

      if (isTextLikeFile(file)) {
        content = (await file.text()).slice(0, 14000);
      } else if ((isJarvisImageFile(file) || isJarvisPdfFile(file)) && file.size <= MAX_JARVIS_FILE_BYTES) {
        dataUrl = await readFileAsDataUrl(file);
      }

      next.push({
        filename: file.name,
        mimeType: file.type || null,
        content,
        dataUrl,
      });
    }

    setAssistantAttachments(next);
  }

  async function askJarvis(question: string) {
    const trimmed = question.trim() || (assistantAttachments.length > 0 ? t("jarvisDock.defaultAttachmentQuestion") : "");
    if (!trimmed) return;

    const userMessage: JarvisMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      text: trimmed,
      bullets: [],
      links: [],
      actions: [],
      source: null,
    };
    const history = jarvisMessages
      .slice(-10)
      .map((item) => ({ role: item.role, text: item.text }));

    setJarvisMessages((current) => [...current, userMessage]);
    setAssistantQuestion("");
    setBusyKey("assistant");
    setMessage("");

    const response = await fetch("/api/ai/assistant", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        question: trimmed,
        attachments: assistantAttachments,
        history,
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

    const assistant = result.assistant;
    setJarvisMessages((current) => [
      ...current,
      {
        id: `assistant-${Date.now()}`,
        role: "assistant",
        text: assistant.answer,
        bullets: assistant.bullets,
        links: assistant.links,
        actions: assistant.actions ?? [],
        source: assistant.source,
      },
    ]);
    setAssistantAttachments([]);
    setBusyKey(null);
    if (assistant.memorySaved) {
      setMessage(t("jarvisDock.memorySaved"));
    }
  }

  async function handleAskAssistant(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await askJarvis(assistantQuestion);
  }

  function openAssistantLink(link: AssistantLink) {
    if (link.href.startsWith("https://")) {
      window.open(link.href, "_blank", "noopener,noreferrer");
      return;
    }

    router.push(link.href);
  }

  async function runAssistantAction(action: AssistantAction) {
    if (action.kind === "navigate") {
      openAssistantLink({ label: action.label, href: action.href });
      return;
    }

    setMessage(t("jarvisDock.actionRunning"));
    try {
      const response = await fetch("/api/ai/actions/create-project", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action.payload),
      });
      const result = (await response.json()) as { error?: string; projectId?: string | null };
      if (!response.ok || !result.projectId) {
        setMessage(result.error ?? t("jarvisDock.actionFailed"));
        return;
      }
      setMessage(t("jarvisDock.projectCreated"));
      router.push(`/projects/${result.projectId}`);
    } catch {
      setMessage(t("jarvisDock.actionFailed"));
    }
  }

  return (
    <div className="mx-auto max-w-[1400px] space-y-5 p-5">
      <section className="surface-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-4">
            <JarvisOrb size="lg" state={hasModelProvider ? "idle" : "notification"} />
            <div className="min-w-0 space-y-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[var(--ai-cyan)]">
                {t("ai.title")}
              </p>
              <h1 className="text-[28px] font-bold text-[var(--text-primary)]">
                {t("ai.subtitle")}
              </h1>
              <p className="max-w-[74ch] text-sm leading-6 text-[var(--text-secondary)]">
                {t("ai.description")}
              </p>
            </div>
          </div>
          <div
            className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.14em]"
            style={{
              borderColor: hasModelProvider ? "rgba(105, 231, 255, 0.34)" : "rgba(200, 169, 59, 0.34)",
              background: hasModelProvider ? "rgba(105, 231, 255, 0.08)" : "rgba(200, 169, 59, 0.1)",
              color: hasModelProvider ? "var(--ai-cyan-bright)" : "var(--brand-gold-light)",
            }}
          >
            {hasModelProvider ? t("ai.realModelConnected") : t("ai.smartFallback")}
          </div>
        </div>
      </section>

      {message ? (
        <div
          className="rounded-[var(--radius-md)] px-3 py-3 text-sm"
          style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}
        >
          {message}
        </div>
      ) : null}

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        {jarvisSettingsCards.map((card) => (
          <article key={card.title} className="surface-card p-4">
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ai-cyan)]">
              {card.title}
            </div>
            <p className="mt-3 min-h-[70px] text-sm leading-6 text-[var(--text-secondary)]">
              {card.body}
            </p>
            <div
              className="mt-4 rounded-[var(--radius-pill)] border px-3 py-1.5 text-[10px] font-bold uppercase tracking-[0.12em]"
              style={{
                borderColor: "rgba(105, 231, 255, 0.26)",
                background: "rgba(105, 231, 255, 0.07)",
                color: "var(--ai-cyan-bright)",
              }}
            >
              {card.status}
            </div>
          </article>
        ))}
      </section>

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
            {hasModelProvider ? t("ai.modelProviderReady") : t("ai.fallbackActive")}
          </div>
        </div>
      </section>

      <section className="surface-card p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex items-start gap-3">
            <JarvisOrb size="md" state={busyKey === "assistant" ? "thinking" : "idle"} />
            <div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--ai-cyan)]">
              {t("ai.jarvisEyebrow")}
            </div>
            <h2 className="mt-1 text-2xl font-bold text-[var(--text-primary)]">
              {t("ai.jarvisTitle")}
            </h2>
            <p className="mt-2 max-w-[76ch] text-sm leading-6 text-[var(--text-secondary)]">
              {t("ai.jarvisDescription")}
            </p>
            </div>
          </div>
          <div
            className="rounded-[var(--radius-pill)] px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]"
            style={{
              background: hasModelProvider
                ? "rgba(15, 168, 120, 0.16)"
                : "rgba(191, 162, 52, 0.12)",
              color: hasModelProvider ? "var(--green)" : "var(--brand-yellow)",
            }}
          >
            {hasModelProvider ? t("ai.realModelConnected") : t("ai.smartFallback")}
          </div>
        </div>

        <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_340px]">
          <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
            <div className="max-h-[460px] min-h-[260px] space-y-3 overflow-y-auto pr-1">
              {jarvisMessages.length === 0 ? (
                <div className="rounded-[var(--radius-md)] border border-[rgba(191,162,52,0.24)] bg-[rgba(191,162,52,0.08)] p-4">
                  <div className="text-sm font-semibold text-[var(--text-primary)]">
                    {t("ai.jarvisWelcomeTitle")}
                  </div>
                  <p className="mt-2 text-sm leading-6 text-[var(--text-secondary)]">
                    {t("ai.jarvisWelcome")}
                  </p>
                </div>
              ) : (
                jarvisMessages.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-[var(--radius-md)] border p-3"
                    style={{
                      marginLeft: item.role === "user" ? "auto" : undefined,
                      maxWidth: item.role === "user" ? "82%" : "100%",
                      background:
                        item.role === "user"
                          ? "rgba(191, 162, 52, 0.14)"
                          : "rgba(255, 255, 255, 0.03)",
                      borderColor:
                        item.role === "user"
                          ? "rgba(191, 162, 52, 0.3)"
                          : "var(--border-default)",
                    }}
                  >
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--text-muted)]">
                        {item.role === "user" ? t("ai.jarvisYou") : t("ai.jarvisName")}
                      </div>
                      {item.source ? (
                        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--brand-yellow)]">
                          {item.source === "fallback" ? t("ai.sourceFallback") : t("ai.sourceModel")}
                        </div>
                      ) : null}
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-[var(--text-secondary)]">
                      {item.text}
                    </p>
                    {item.bullets.length > 0 ? (
                      <div className="mt-3 space-y-2">
                        {item.bullets.map((bullet) => (
                          <div key={bullet} className="text-sm text-[var(--text-primary)]">
                            {bullet}
                          </div>
                        ))}
                      </div>
                    ) : null}
                    {item.links.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.links.map((link) => (
                          <button
                            key={`${item.id}-${link.href}`}
                            type="button"
                            onClick={() => openAssistantLink(link)}
                            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                            style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                          >
                            {link.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                    {item.actions.length > 0 ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {item.actions.map((action) => (
                          <button
                            key={`${item.id}-${action.kind}-${action.label}`}
                            type="button"
                            onClick={() => void runAssistantAction(action)}
                            disabled={busyKey !== null}
                            className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                            style={{
                              borderColor: "rgba(105, 231, 255, 0.3)",
                              background: "rgba(105, 231, 255, 0.08)",
                              color: "var(--ai-cyan-bright)",
                            }}
                          >
                            {action.label}
                          </button>
                        ))}
                      </div>
                    ) : null}
                  </div>
                ))
              )}
              {busyKey === "assistant" ? (
                <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[rgba(255,255,255,0.03)] p-3 text-sm text-[var(--text-secondary)]">
                  {t("ai.jarvisThinking")}
                </div>
              ) : null}
            </div>
            <form className="mt-3 grid gap-3" onSubmit={handleAskAssistant}>
              <input
                ref={assistantFileInputRef}
                type="file"
                multiple
                className="hidden"
                accept=".txt,.md,.csv,.json,.log,.xml,.pdf,image/png,image/jpeg,image/webp,image/gif"
                onChange={(event) => void handleAssistantFiles(event.target.files)}
              />
              {assistantAttachments.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {assistantAttachments.map((attachment) => (
                    <span
                      key={`${attachment.filename}-${attachment.mimeType ?? "file"}`}
                      className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold"
                      style={{
                        borderColor:
                          attachment.content || attachment.dataUrl
                            ? "rgba(105, 231, 255, 0.3)"
                            : "rgba(239, 83, 104, 0.32)",
                        background:
                          attachment.content || attachment.dataUrl
                            ? "rgba(105, 231, 255, 0.08)"
                            : "rgba(239, 83, 104, 0.1)",
                        color:
                          attachment.content || attachment.dataUrl
                            ? "var(--ai-cyan-bright)"
                            : "var(--red)",
                      }}
                    >
                      {attachment.filename}
                    </span>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAssistantAttachments([])}
                    className="rounded-[var(--radius-pill)] border px-3 py-1.5 text-xs font-semibold text-[var(--text-secondary)]"
                    style={{ borderColor: "var(--border-default)" }}
                  >
                    {t("common.clear")}
                  </button>
                </div>
              ) : null}
              <TextInputWithVoice
                multiline
                value={assistantQuestion}
                onChange={(event) => setAssistantQuestion(event.target.value)}
                placeholder={t("ai.assistantPlaceholder")}
                className="min-h-[96px] rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-card)] px-3 py-3 text-sm text-[var(--text-primary)] outline-none"
              />
              <div className="grid gap-2 sm:grid-cols-[auto_1fr]">
                <button
                  type="button"
                  onClick={() => assistantFileInputRef.current?.click()}
                  disabled={busyKey === "assistant"}
                  className="inline-flex items-center justify-center gap-2 rounded-[var(--radius-sm)] border px-4 py-3 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-60"
                  style={{
                    borderColor: "rgba(105, 231, 255, 0.28)",
                    color: "var(--ai-cyan-bright)",
                  }}
                >
                  <Paperclip size={16} />
                  {t("jarvisDock.attach")}
                </button>
                <button
                  type="submit"
                  disabled={
                    (!assistantQuestion.trim() && assistantAttachments.length === 0) ||
                    busyKey === "assistant"
                  }
                  className="rounded-[var(--radius-sm)] px-4 py-3 text-sm font-semibold"
                  style={{
                    background:
                      (!assistantQuestion.trim() && assistantAttachments.length === 0) ||
                      busyKey === "assistant"
                        ? "var(--border-default)"
                        : "var(--brand-yellow)",
                    color:
                      (!assistantQuestion.trim() && assistantAttachments.length === 0) ||
                      busyKey === "assistant"
                        ? "var(--text-muted)"
                        : "var(--text-inverse)",
                  }}
                >
                  {busyKey === "assistant" ? t("ai.thinking") : t("ai.askJarvis")}
                </button>
              </div>
            </form>
          </div>

          <aside className="space-y-3">
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3">
              <div className="text-xs font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                {t("ai.jarvisQuickTitle")}
              </div>
              <div className="mt-3 grid gap-2">
                {quickJarvisQuestions.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => void askJarvis(question)}
                    disabled={busyKey === "assistant"}
                    className="rounded-[var(--radius-sm)] border px-3 py-2 text-left text-xs font-semibold leading-5 disabled:cursor-not-allowed disabled:opacity-60"
                    style={{ borderColor: "var(--border-default)", color: "var(--text-primary)" }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-xs leading-5 text-[var(--text-secondary)]">
              {t("ai.jarvisScope")}
            </div>
          </aside>
        </div>
      </section>

      <section className="grid gap-5 xl:grid-cols-[1fr]">
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
