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

/** ISO → local "YYYY-MM-DDTHH:mm" (local wall-clock, minutes). */
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/** ISO → local date ("YYYY-MM-DD") + time ("HH:MM") parts for the split inputs. */
function isoToLocalParts(iso: string | null | undefined): { date: string; time: string } {
  const local = toLocalInput(iso);
  return local ? { date: local.slice(0, 10), time: local.slice(11, 16) } : { date: "", time: "" };
}

/** True for a full "HH:MM" 24-hour time (00-23 / 00-59). */
function isValidTime(value: string): boolean {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return false;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  return hours >= 0 && hours <= 23 && minutes >= 0 && minutes <= 59;
}

/** Live-format keystrokes into "HH:MM": digits only, colon auto-inserted after 2. */
function formatTimeInput(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 4);
  if (digits.length <= 2) return digits;
  return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

/** Local date + "HH:MM" → ISO, or null if either part is missing/invalid. */
function composeIso(date: string, time: string): string | null {
  if (!date || !isValidTime(time)) return null;
  const composed = new Date(`${date}T${time}:00`); // parsed as local wall-clock time
  return Number.isNaN(composed.getTime()) ? null : composed.toISOString();
}

function localDay(iso: string | null | undefined): string {
  return isoToLocalParts(iso).date;
}

/** Local calendar day "YYYY-MM-DD" → local-midnight..+24h as ISO timestamps. */
function localDayWindow(day: string): { from: string; to: string } | null {
  if (!day) return null;
  const start = new Date(`${day}T00:00:00`); // parsed as local wall-clock time
  if (Number.isNaN(start.getTime())) return null;
  return {
    from: start.toISOString(),
    to: new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString(),
  };
}

function formatHintTime(iso: string): string {
  return isoToLocalParts(iso).time;
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

  const initialIn = mode === "edit" ? isoToLocalParts(session?.clockInTime) : { date: "", time: "" };
  const initialOut = mode === "edit" ? isoToLocalParts(session?.clockOutTime) : { date: "", time: "" };

  const [inDate, setInDate] = useState(initialIn.date);
  const [inTime, setInTime] = useState(initialIn.time);
  const [outDate, setOutDate] = useState(initialOut.date);
  const [outTime, setOutTime] = useState(initialOut.time);
  const [inTimeTouched, setInTimeTouched] = useState(false);
  const [outTimeTouched, setOutTimeTouched] = useState(false);
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
    // In create mode the day comes straight from the date input (already
    // "YYYY-MM-DD"); in edit mode it derives from the shift's clock-in.
    const hintDay = mode === "edit" ? localDay(session?.clockInTime) : inDate;
    const dayWindow = localDayWindow(hintDay);
    let cancelled = false;
    const applyHint = (value: { from: string; to: string } | null) => {
      if (!cancelled) setHint(value);
    };

    if (!hintProjectId || !dayWindow) {
      // Defer to a microtask so we never setState synchronously in the effect.
      Promise.resolve().then(() => applyHint(null));
      return () => {
        cancelled = true;
      };
    }

    void fetch(
      `/api/team/edit-shift?projectId=${encodeURIComponent(hintProjectId)}` +
        `&excludeProfileId=${encodeURIComponent(workerId)}` +
        `&from=${encodeURIComponent(dayWindow.from)}&to=${encodeURIComponent(dayWindow.to)}`,
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
  }, [mode, session?.projectId, session?.clockInTime, projectId, inDate, workerId]);

  const inTimeValid = isValidTime(inTime);
  const outTimeValid = isValidTime(outTime);
  const canSave =
    !busy &&
    Boolean(inDate) &&
    Boolean(outDate) &&
    inTimeValid &&
    outTimeValid &&
    (mode !== "create" || Boolean(projectId));

  async function handleSave() {
    setError("");
    const inIso = composeIso(inDate, inTime);
    const outIso = composeIso(outDate, outTime);
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

  const dateInputClass =
    "flex-1 rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-base text-[var(--text-primary)]";
  const timeInputClass = (showError: boolean) =>
    `w-24 rounded-[var(--radius-md)] border ${
      showError ? "border-[var(--red)]" : "border-[var(--border-default)]"
    } bg-[var(--bg-primary)] px-3 py-2.5 text-center text-base text-[var(--text-primary)]`;

  const inTimeShowError = inTimeTouched && !inTimeValid;
  const outTimeShowError = outTimeTouched && !outTimeValid;

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
              className="mt-1 w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-base text-[var(--text-primary)]"
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

        <div className="mt-3">
          <div className="text-xs text-[var(--text-secondary)]">{t("shiftEdit.clockIn")}</div>
          <div className="mt-1 flex gap-2">
            <input
              type="date"
              className={dateInputClass}
              value={inDate}
              onChange={(event) => setInDate(event.target.value)}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              maxLength={5}
              className={timeInputClass(inTimeShowError)}
              value={inTime}
              onChange={(event) => setInTime(formatTimeInput(event.target.value))}
              onBlur={() => setInTimeTouched(true)}
            />
          </div>
        </div>

        <div className="mt-3">
          <div className="text-xs text-[var(--text-secondary)]">{t("shiftEdit.clockOut")}</div>
          <div className="mt-1 flex gap-2">
            <input
              type="date"
              className={dateInputClass}
              value={outDate}
              onChange={(event) => setOutDate(event.target.value)}
            />
            <input
              type="text"
              inputMode="numeric"
              placeholder="HH:MM"
              maxLength={5}
              className={timeInputClass(outTimeShowError)}
              value={outTime}
              onChange={(event) => setOutTime(formatTimeInput(event.target.value))}
              onBlur={() => setOutTimeTouched(true)}
            />
          </div>
        </div>

        {hint && (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[var(--radius-md)] bg-[var(--bg-primary)] px-2.5 py-2">
            <span className="text-xs text-[var(--text-secondary)]">
              {t("shiftEdit.crewLeftBetween")
                .replace("{from}", formatHintTime(hint.from))
                .replace("{to}", formatHintTime(hint.to))}
            </span>
            <button
              type="button"
              className="shrink-0 rounded-[var(--radius-pill)] border border-[var(--border-default)] px-3 py-2 text-xs font-semibold text-[var(--text-primary)]"
              onClick={() => {
                setOutTime(formatHintTime(hint.to));
                setOutTimeTouched(true);
              }}
            >
              {t("shiftEdit.applyHint")}
            </button>
          </div>
        )}

        {error && <p className="mt-3 text-xs text-[var(--red)]">{error}</p>}

        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            className="rounded-[var(--radius-md)] px-3 py-2.5 text-sm text-[var(--text-secondary)]"
            onClick={onClose}
            disabled={busy}
          >
            {t("shiftEdit.cancel")}
          </button>
          <button
            type="button"
            className="rounded-[var(--radius-md)] bg-[var(--brand-yellow)] px-4 py-2.5 text-sm font-semibold text-black disabled:opacity-60"
            onClick={handleSave}
            disabled={!canSave}
          >
            {t("shiftEdit.save")}
          </button>
        </div>
      </div>
    </div>
  );
}
