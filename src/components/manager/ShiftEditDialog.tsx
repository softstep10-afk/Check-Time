"use client";

import { useEffect, useState } from "react";
import { useTranslation } from "@/lib/i18n";
import type { ManagerSession } from "@/lib/manager-types";

type ShiftEditDialogProps = {
  mode: "edit" | "create";
  session?: ManagerSession | null;
  workerId: string;
  workerName: string;
  projects: { id: string; name: string }[];
  defaultProjectId?: string | null;
  onClose: () => void;
  onSaved: () => void;
};

/** ISO → value for <input type="datetime-local"> (local wall-clock, minutes). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** datetime-local value (local) → ISO, or null if empty/invalid. */
function localInputToIso(value: string): string | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function localDay(iso: string | null | undefined): string {
  const local = toLocalInput(iso);
  return local ? local.slice(0, 10) : "";
}

function formatHintTime(iso: string): string {
  const local = toLocalInput(iso);
  return local ? local.slice(11, 16) : "";
}

export function ShiftEditDialog({
  mode,
  session,
  workerId,
  workerName,
  projects,
  defaultProjectId,
  onClose,
  onSaved,
}: ShiftEditDialogProps) {
  const { t } = useTranslation();

  const [clockIn, setClockIn] = useState(() =>
    mode === "edit" ? toLocalInput(session?.clockInTime) : "",
  );
  const [clockOut, setClockOut] = useState(() =>
    mode === "edit" ? toLocalInput(session?.clockOutTime) : "",
  );
  const [projectId, setProjectId] = useState(
    mode === "edit" ? session?.projectId ?? "" : defaultProjectId ?? "",
  );
  const [hint, setHint] = useState<{ from: string; to: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // Crew hint: fetch the other workers' clock-out window for this project+day.
  // Suggestion only — never writes.
  useEffect(() => {
    const hintProjectId = mode === "edit" ? session?.projectId : projectId;
    const hintDay = mode === "edit" ? localDay(session?.clockInTime) : localDay(clockIn);
    let cancelled = false;
    const applyHint = (value: { from: string; to: string } | null) => {
      if (!cancelled) setHint(value);
    };

    if (!hintProjectId || !hintDay) {
      // Defer to a microtask so we never setState synchronously in the effect.
      Promise.resolve().then(() => applyHint(null));
      return () => {
        cancelled = true;
      };
    }

    void fetch(
      `/api/team/edit-shift?projectId=${encodeURIComponent(hintProjectId)}&day=${encodeURIComponent(hintDay)}`,
    )
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { crewLeftFrom?: string | null; crewLeftTo?: string | null } | null) => {
        applyHint(
          data?.crewLeftFrom && data.crewLeftTo
            ? { from: data.crewLeftFrom, to: data.crewLeftTo }
            : null,
        );
      })
      .catch(() => applyHint(null));

    return () => {
      cancelled = true;
    };
  }, [mode, session?.projectId, session?.clockInTime, projectId, clockIn]);

  async function handleSave() {
    setError("");
    const inIso = localInputToIso(clockIn);
    const outIso = localInputToIso(clockOut);
    if (!inIso || !outIso) {
      setError(t("shiftEdit.outAfterIn"));
      return;
    }
    if (new Date(outIso).getTime() <= new Date(inIso).getTime()) {
      setError(t("shiftEdit.outAfterIn"));
      return;
    }
    if (mode === "create" && !projectId) {
      setError(t("shiftEdit.selectWorkerProject"));
      return;
    }

    setBusy(true);
    try {
      const requestBody =
        mode === "edit"
          ? {
              mode: "edit",
              clockInEventId: session?.clockInEventId,
              newClockInTime: inIso,
              newClockOutTime: outIso,
            }
          : {
              mode: "create",
              workerId,
              projectId,
              clockInTime: inIso,
              clockOutTime: outIso,
            };
      const response = await fetch("/api/team/edit-shift", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        setError(payload.error ?? t("shiftEdit.error"));
        setBusy(false);
        return;
      }
      onSaved();
    } catch {
      setError(t("shiftEdit.error"));
      setBusy(false);
    }
  }

  const title = mode === "edit" ? t("shiftEdit.editTitle") : t("shiftEdit.createTitle");

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-[var(--radius-lg)] border border-[var(--border-default)] bg-[var(--bg-card)] p-4"
        onClick={(event) => event.stopPropagation()}
      >
        <h3 className="text-base font-bold text-[var(--text-primary)]">{title}</h3>
        <p className="mt-1 text-xs text-[var(--text-muted)]">{workerName}</p>

        {mode === "create" && (
          <label className="mt-3 block text-xs text-[var(--text-secondary)]">
            {t("shiftEdit.project")}
            <select
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
              value={projectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">—</option>
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="mt-3 block text-xs text-[var(--text-secondary)]">
          {t("shiftEdit.clockIn")}
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            value={clockIn}
            onChange={(event) => setClockIn(event.target.value)}
          />
        </label>

        <label className="mt-3 block text-xs text-[var(--text-secondary)]">
          {t("shiftEdit.clockOut")}
          <input
            type="datetime-local"
            className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-2 py-1.5 text-sm text-[var(--text-primary)]"
            value={clockOut}
            onChange={(event) => setClockOut(event.target.value)}
          />
        </label>

        {hint && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-2.5 py-2">
            <span className="text-xs text-[var(--text-secondary)]">
              {t("shiftEdit.crewLeftBetween")
                .replace("{from}", formatHintTime(hint.from))
                .replace("{to}", formatHintTime(hint.to))}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--border-default)] px-2 py-1 text-[10px] font-semibold text-[var(--text-primary)]"
              onClick={() => setClockOut(toLocalInput(hint.to))}
            >
              {t("shiftEdit.applyHint")}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-[var(--red)]">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-[var(--radius-md)] px-3 py-1.5 text-sm text-[var(--text-secondary)]"
            onClick={onClose}
            disabled={busy}
          >
            {t("shiftEdit.cancel")}
          </button>
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--brand-yellow)] px-3 py-1.5 text-sm font-semibold text-black disabled:opacity-60"
            onClick={handleSave}
            disabled={busy}
          >
            {t("shiftEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
