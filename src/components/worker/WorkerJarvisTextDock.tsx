"use client";

import { useState } from "react";
import { Send, X } from "lucide-react";
import { JarvisOrb, type JarvisOrbState } from "@/components/shared/JarvisOrb";

type WorkerJarvisAnswer = {
  answer: string;
  bullets: string[];
  links: Array<{ label: string; href: string }>;
};

export function WorkerJarvisTextDock({
  workerName,
  language,
}: {
  workerName: string;
  language: string | null;
}) {
  const ru = language !== "en";
  const [open, setOpen] = useState(false);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<WorkerJarvisAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const orbState: JarvisOrbState = busy ? "thinking" : answer ? "speaking" : open ? "listening" : "idle";

  async function askJarvis() {
    const trimmed = question.trim();
    if (!trimmed || busy) return;

    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/worker/jarvis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: trimmed }),
      });
      const payload = (await response.json()) as {
        assistant?: WorkerJarvisAnswer;
        error?: string;
      };

      if (!response.ok || !payload.assistant) {
        throw new Error(payload.error ?? "Jarvis request failed.");
      }

      setAnswer(payload.assistant);
      setQuestion("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Jarvis request failed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="fixed bottom-[88px] right-4 z-40 rounded-full border p-2 shadow-[0_0_28px_rgba(56,189,248,0.32)]"
        style={{
          background: "rgba(4, 18, 31, 0.9)",
          borderColor: "rgba(125, 231, 255, 0.35)",
          color: "var(--ai-cyan)",
        }}
        aria-label={ru ? "Открыть Jarvis" : "Open Jarvis"}
        title={ru ? "Открыть Jarvis" : "Open Jarvis"}
      >
        <JarvisOrb state={orbState} size="sm" />
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center p-3"
          style={{ background: "rgba(0, 4, 10, 0.58)" }}
          onClick={() => setOpen(false)}
        >
          <section
            className="surface-card w-full max-w-[500px] p-4"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <JarvisOrb state={orbState} size="sm" />
                <div className="min-w-0">
                  <h2 className="text-base font-bold text-[var(--text-primary)]">Jarvis</h2>
                  <p className="text-xs text-[var(--text-secondary)]">
                    {ru
                      ? `${workerName}, рабочий режим: задачи, проекты, материалы`
                      : `${workerName}, worker mode: tasks, projects, materials`}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-[var(--radius-sm)] border p-2 text-[var(--text-secondary)]"
                style={{ borderColor: "var(--border-default)" }}
                aria-label={ru ? "Закрыть" : "Close"}
              >
                <X size={18} />
              </button>
            </div>

            <div className="mt-4 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] p-3 text-sm leading-6 text-[var(--text-secondary)]">
              {answer ? (
                <>
                  <p className="font-semibold text-[var(--text-primary)]">{answer.answer}</p>
                  {answer.bullets.length > 0 ? (
                    <ul className="mt-2 space-y-1">
                      {answer.bullets.map((bullet, index) => (
                        <li key={`${bullet}-${index}`}>{bullet}</li>
                      ))}
                    </ul>
                  ) : null}
                  {answer.links.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {answer.links.map((link) => (
                        <a key={link.href} href={link.href} className="button-base button-secondary px-3 py-2 text-xs">
                          {link.label}
                        </a>
                      ))}
                    </div>
                  ) : null}
                </>
              ) : (
                <p>
                  {ru
                    ? "Спроси: какие у меня задачи, какие материалы на проекте, где моя смена."
                    : "Ask about your tasks, visible project materials, or your current shift."}
                </p>
              )}
            </div>

            {error ? (
              <div className="mt-3 rounded-[var(--radius-md)] border border-red-500/25 bg-red-500/10 p-3 text-sm text-[var(--red)]">
                {error}
              </div>
            ) : null}

            <div className="mt-3 flex gap-2">
              <textarea
                value={question}
                onChange={(event) => setQuestion(event.target.value)}
                rows={2}
                className="min-h-[64px] flex-1 resize-none rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-sm text-[var(--text-primary)] outline-none focus:border-[var(--ai-cyan)]"
                placeholder={ru ? "Спроси Jarvis..." : "Ask Jarvis..."}
              />
              <button
                type="button"
                onClick={() => void askJarvis()}
                disabled={!question.trim() || busy}
                className="button-base button-primary px-3"
                aria-label={ru ? "Отправить" : "Send"}
              >
                <Send size={18} />
              </button>
            </div>

            <p className="mt-2 text-[11px] text-[var(--text-muted)]">
              {ru
                ? "Финансы, ставки и зарплата скрыты в рабочем режиме."
                : "Finance, rates, and payroll are hidden in worker mode."}
            </p>
          </section>
        </div>
      ) : null}
    </>
  );
}
