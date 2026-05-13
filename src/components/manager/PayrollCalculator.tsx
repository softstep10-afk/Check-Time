"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calculator, Download, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { DateField } from "@/components/shared/DateField";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { logAudit } from "@/lib/audit";
import {
  buildPayrollDraftRows,
  buildWorkerDisambiguationMap,
  formatWorkerDisplayLabel,
  groupPayrollRowsByDay,
  groupPayrollRowsByWorker,
  sumDraftRowMinutes,
  type PayrollDraftRow,
} from "@/lib/manager-utils";
import {
  buildPayrollLedgerLineDrafts,
  getPaidWorkerIdsAfter,
  rollupPayPeriodStatus,
} from "@/lib/payroll-period-utils";
import type { Profile, UserRole } from "@/types/database";
import type { ManagerSession } from "@/lib/manager-types";
import { formatEventTime } from "@/lib/worker-utils";

// ── Types ──

type PeriodType = "weekly" | "biweekly" | "semi-monthly" | "monthly" | "custom";
type PeriodStatus = "draft" | "approved" | "paid";
type ItemStatus = "pending" | "approved" | "paid";
type AdjType = "bonus" | "reimbursement" | "deduction";

type Adjustment = {
  id: string;
  type: AdjType;
  amount: number;
  note: string;
};

type WorkerLine = {
  itemId: string | null; // pay_period_items.id — null for in-memory only
  workerId: string;
  workerName: string;
  workerRole: string;
  rate: number;
  regHours: number;
  otHours: number;
  // No-GPS hours within the period. Only meaningful for freshly-built
  // periods; loaded-from-DB periods report 0 because we don't persist
  // this breakdown yet.
  noGpsHours: number;
  grossRegular: number;
  grossOt: number;
  adjustments: Adjustment[];
  grossTotal: number;
  netTotal: number;
  status: ItemStatus;
  hasHours: boolean;
  projectBreakdown: Array<{
    projectId: string;
    projectName: string;
    hours: number;
    amount: number;
    eventIds: string[];
    sessionIds: string[];
  }>;
};

type PayPeriod = {
  id: string;
  label: string;
  startDate: string;
  endDate: string;
  type: PeriodType;
  status: PeriodStatus;
  lines: WorkerLine[];
};

// ── Helpers ──

const OT_THRESHOLD = 40;
const OT_MULTIPLIER = 1.5;

const currency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" });

function computeOt(totalHours: number): { reg: number; ot: number } {
  if (totalHours <= OT_THRESHOLD) return { reg: totalHours, ot: 0 };
  return { reg: OT_THRESHOLD, ot: Math.round((totalHours - OT_THRESHOLD) * 100) / 100 };
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function buildWorkerLines(
  profiles: Profile[],
  sessions: ManagerSession[],
  startDate: string,
  endDate: string,
  hasGpsBySessionId: Record<string, boolean>,
): WorkerLine[] {
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T23:59:59`).getTime();

  // Hours come exclusively from sessions, and `buildManagerSessions`
  // only opens a session on a real `clock_in` event. So workers who
  // never checked in cannot accrue minutes here — see #2 of the
  // payroll-safety task.
  const hoursByWorker = new Map<
    string,
    {
      total: number;
      noGps: number;
      byProject: Map<string, {
        id: string;
        name: string;
        minutes: number;
        eventIds: string[];
        sessionIds: string[];
      }>;
    }
  >();

  for (const s of sessions) {
    const sStart = new Date(s.clockInTime).getTime();
    const sEnd = s.clockOutTime ? new Date(s.clockOutTime).getTime() : Date.now();
    const effStart = Math.max(sStart, startMs);
    const effEnd = Math.min(sEnd, endMs);
    if (effEnd <= effStart) continue;

    const minutes = Math.round((effEnd - effStart) / 60_000);
    const entry = hoursByWorker.get(s.profileId) ?? { total: 0, noGps: 0, byProject: new Map() };
    entry.total += minutes;
    if (!hasGpsBySessionId[s.id]) entry.noGps += minutes;
    const proj = entry.byProject.get(s.projectId) ?? {
      id: s.projectId,
      name: s.projectName,
      minutes: 0,
      eventIds: [],
      sessionIds: [],
    };
    proj.minutes += minutes;
    proj.eventIds.push(...s.eventIds);
    proj.sessionIds.push(s.id);
    entry.byProject.set(s.projectId, proj);
    hoursByWorker.set(s.profileId, entry);
  }

  return profiles
    .filter((p) => !p.deleted_at)
    .map((p) => {
      const data = hoursByWorker.get(p.id);
      const totalHours = data ? r2(data.total / 60) : 0;
      const noGpsHours = data ? r2(data.noGps / 60) : 0;
      const { reg, ot } = computeOt(totalHours);
      const rate = Number(p.hourly_rate ?? 0);
      const grossReg = r2(reg * rate);
      const grossOt = r2(ot * rate * OT_MULTIPLIER);
      const grossTotal = grossReg + grossOt;

      const projectBreakdown = data
        ? Array.from(data.byProject.entries()).map(([, v]) => ({
            projectId: v.id,
            projectName: v.name,
            hours: r2(v.minutes / 60),
            amount: r2((v.minutes / 60) * rate),
            eventIds: [...new Set(v.eventIds)],
            sessionIds: [...new Set(v.sessionIds)],
          }))
        : [];

      return {
        itemId: null,
        workerId: p.id,
        workerName: p.name,
        workerRole: p.role,
        rate,
        regHours: reg,
        otHours: ot,
        noGpsHours,
        grossRegular: grossReg,
        grossOt,
        adjustments: [],
        grossTotal,
        netTotal: grossTotal,
        status: "pending" as ItemStatus,
        hasHours: totalHours > 0,
        projectBreakdown,
      };
    })
    .sort((a, b) => a.workerName.localeCompare(b.workerName));
}

function presetDates(preset: string): { start: string; end: string } {
  const now = new Date();
  const pad = (d: Date) => d.toISOString().slice(0, 10);

  if (preset === "lastWeek") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const lastMon = new Date(now);
    lastMon.setDate(now.getDate() + mondayOffset - 7);
    const lastSun = new Date(lastMon);
    lastSun.setDate(lastMon.getDate() + 6);
    return { start: pad(lastMon), end: pad(lastSun) };
  }
  if (preset === "last2Weeks") {
    const day = now.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const start = new Date(now);
    start.setDate(now.getDate() + mondayOffset - 14);
    const end = new Date(start);
    end.setDate(start.getDate() + 13);
    return { start: pad(start), end: pad(end) };
  }
  if (preset === "thisMonth") {
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const end = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    return { start: pad(start), end: pad(end) };
  }
  return { start: pad(now), end: pad(now) };
}

function generateCsv(period: PayPeriod): string {
  const headers = "Name,Role,Reg Hours,OT Hours,No-GPS Hours,Rate,Gross Reg,Gross OT,Bonus,Reimbursement,Deduction,Net,Period Start,Period End";
  const rows = period.lines
    .filter((l) => l.hasHours)
    .map((l) => {
      const bonus = l.adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
      const reimb = l.adjustments.filter((a) => a.type === "reimbursement").reduce((s, a) => s + a.amount, 0);
      const deduct = l.adjustments.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
      return `"${l.workerName}","${l.workerRole}",${l.regHours},${l.otHours},${l.noGpsHours},${l.rate},${l.grossRegular},${l.grossOt},${bonus},${reimb},${deduct},${l.netTotal},"${period.startDate}","${period.endDate}"`;
    });
  return [headers, ...rows].join("\n");
}

// ── Shift detail rendering ──

// Row in the chronology + per-worker shift listing. Pure presentational —
// review flags come prebuilt from buildPayrollDraftRows so this stays
// trivial to reason about and easy to swap to compact / expanded modes
// later. The same row markup is used for the Per-Worker expanded shift
// list and the Chronology day buckets.
function ShiftRow({
  row,
  t,
  showWorker,
}: {
  row: PayrollDraftRow;
  t: ReturnType<typeof useTranslation>["t"];
  showWorker?: boolean;
}) {
  const isCritical = row.shiftSeverity === "critical";
  const isWarning = row.shiftSeverity === "warning";
  const flagBg = isCritical
    ? "rgba(212, 81, 94, 0.06)"
    : isWarning
      ? "rgba(245, 158, 11, 0.06)"
      : "transparent";
  const flagBorder = isCritical
    ? "rgba(212, 81, 94, 0.45)"
    : isWarning
      ? "rgba(245, 158, 11, 0.35)"
      : "var(--border-default)";
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 px-2 py-2 text-xs"
      style={{ background: flagBg, borderLeft: `3px solid ${flagBorder}` }}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          {showWorker ? (
            <span className="font-semibold text-[var(--text-primary)]">
              {row.profileName}
            </span>
          ) : null}
          <span className="text-[var(--text-secondary)]">{row.projectName}</span>
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-[var(--text-muted)]">
          <span>{formatEventTime(row.clockInTime)}</span>
          <span>→</span>
          <span>
            {row.clockOutTime
              ? formatEventTime(row.clockOutTime)
              : t("payroll.openShift")}
          </span>
          <span>·</span>
          <span>{(row.durationMinutes / 60).toFixed(1)}h</span>
        </div>
        {row.checkoutNote ? (
          <div className="mt-1 truncate text-[10px] italic text-[var(--text-secondary)]">
            “{row.checkoutNote}”
          </div>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-1">
        {isCritical ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
          >
            ≥24h
          </span>
        ) : isWarning ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
          >
            ≥16h
          </span>
        ) : null}
        {!row.hasGps ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
          >
            {t("payroll.noGpsShort")}
          </span>
        ) : null}
        {row.missingCheckout ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
          >
            {t("payroll.missingCheckoutShort")}
          </span>
        ) : null}
        {row.missingVideo ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
          >
            {t("payroll.missingVideoShort")}
          </span>
        ) : null}
        {row.hasTransferGap ? (
          <span
            className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-[0.1em]"
            style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
          >
            {t("payroll.transferGapShort")}
          </span>
        ) : null}
      </div>
    </div>
  );
}

function ShiftDetailList({
  rows,
  t,
}: {
  rows: PayrollDraftRow[];
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="divide-y divide-[var(--border-subtle)]">
      {rows.map((row) => (
        <ShiftRow key={row.sessionId} row={row} t={t} />
      ))}
    </div>
  );
}

// ── Component ──

export function PayrollCalculator({
  orgId,
  managerId,
  managerName,
  managerRole,
  showFinancialFields,
  profiles,
  sessions,
  hasGpsBySessionId,
}: {
  orgId: string;
  managerId: string;
  managerName: string;
  managerRole: string;
  showFinancialFields: boolean;
  profiles: Profile[];
  sessions: ManagerSession[];
  hasGpsBySessionId: Record<string, boolean>;
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const queryPresetAppliedRef = useRef(false);
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("biweekly");
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [savedPeriods, setSavedPeriods] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [tab, setTab] = useState<"workers" | "projects">("workers");
  // Review view mode for the workers tab. byWorker = grouped table with
  // shift rows under each worker. chronology = a single day-grouped
  // timeline across the filtered worker(s). Both surfaces use the same
  // PayrollDraftRow[] derived from sessions + the period dates.
  const [reviewMode, setReviewMode] = useState<"byWorker" | "chronology">(
    "byWorker",
  );
  // Empty string = all workers. Anything else = a profile id. The filter
  // narrows the displayed rows AND the visible selection / bulk-action
  // surface; pay_period_items themselves are unchanged.
  const [workerFilter, setWorkerFilter] = useState<string>("");
  // Per-worker expand/collapse for the byWorker mode.
  const [collapsedWorkerIds, setCollapsedWorkerIds] = useState<Set<string>>(
    new Set(),
  );
  const [error, setError] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  // Adjustment modal
  const [adjWorker, setAdjWorker] = useState<string | null>(null);
  const [adjType, setAdjType] = useState<AdjType>("bonus");
  const [adjAmount, setAdjAmount] = useState("");
  const [adjNote, setAdjNote] = useState("");

  // Load saved periods on mount
  useEffect(() => {
    if (AUTH_BYPASS_ENABLED) return;
    async function load() {
      const { data } = await supabase
        .from("pay_periods")
        .select("id, label, status")
        .eq("org_id", orgId)
        .order("start_date", { ascending: false })
        .limit(20);
      if (data) setSavedPeriods(data as Array<{ id: string; label: string; status: string }>);
    }
    void load();
  }, [supabase, orgId]);

  // Load a saved period's items
  const loadPeriod = useCallback(async function loadPeriod(periodId: string) {
    const { data: periodRow } = await supabase
      .from("pay_periods")
      .select("*")
      .eq("id", periodId)
      .single();
    if (!periodRow) return;

    const p = periodRow as { id: string; label: string; start_date: string; end_date: string; period_type: string; status: string };

    const { data: items } = await supabase
      .from("pay_period_items")
      .select("*")
      .eq("pay_period_id", periodId)
      .order("worker_id");

    const profileMap = new Map(profiles.map((pr) => [pr.id, pr]));
    const lines: WorkerLine[] = ((items ?? []) as Array<{
      id: string; worker_id: string; rate: number; regular_hours: number; overtime_hours: number;
      gross_regular: number; gross_overtime: number; bonus_amount: number; reimbursement_amount: number;
      deduction_amount: number; gross_total: number; net_total: number; adjustments_json: Adjustment[];
      status: string;
    }>).map((item) => {
      const profile = profileMap.get(item.worker_id);
      return {
        itemId: item.id,
        workerId: item.worker_id,
        workerName: profile?.name ?? "Unknown",
        workerRole: profile?.role ?? "worker",
        rate: Number(item.rate),
        regHours: Number(item.regular_hours),
        otHours: Number(item.overtime_hours),
        // No-GPS breakdown isn't persisted yet — show as unknown (0) for
        // historical periods.
        noGpsHours: 0,
        grossRegular: Number(item.gross_regular),
        grossOt: Number(item.gross_overtime),
        adjustments: (item.adjustments_json ?? []) as Adjustment[],
        grossTotal: Number(item.gross_total),
        netTotal: Number(item.net_total),
        status: item.status as ItemStatus,
        hasHours: Number(item.regular_hours) + Number(item.overtime_hours) > 0,
        projectBreakdown: [],
      };
    });

    setPeriod({
      id: p.id,
      label: p.label,
      startDate: p.start_date,
      endDate: p.end_date,
      type: p.period_type as PeriodType,
      status: p.status as PeriodStatus,
      lines,
    });
  }, [supabase, profiles]);

  // Auto-load a period when arriving via /payroll?period=<id> (e.g. from history page).
  useEffect(() => {
    const periodId = searchParams.get("period");
    if (periodId) void loadPeriod(periodId);
  }, [searchParams, loadPeriod]);

  useEffect(() => {
    const workerId = searchParams.get("worker");
    if (!workerId) return;
    if (!profiles.some((profile) => profile.id === workerId)) return;
    setWorkerFilter((current) => (current === workerId ? current : workerId));
  }, [searchParams, profiles]);

  useEffect(() => {
    const preset = searchParams.get("preset");
    if (
      queryPresetAppliedRef.current ||
      period ||
      (preset !== "lastWeek" && preset !== "last2Weeks" && preset !== "thisMonth")
    ) {
      return;
    }
    const dates = presetDates(preset);
    const periodTypeForPreset: PeriodType =
      preset === "lastWeek" ? "weekly" : preset === "last2Weeks" ? "biweekly" : "monthly";
    setStartDate(dates.start);
    setEndDate(dates.end);
    setPeriodType(periodTypeForPreset);
    setShowNewPeriod(true);
    queryPresetAppliedRef.current = true;
  }, [searchParams, period]);

  function handlePreset(preset: string) {
    const dates = presetDates(preset);
    setStartDate(dates.start);
    setEndDate(dates.end);
  }

  async function applyPresetAndCreate(preset: "lastWeek" | "last2Weeks" | "thisMonth") {
    const dates = presetDates(preset);
    const periodTypeForPreset: PeriodType =
      preset === "lastWeek" ? "weekly" : preset === "last2Weeks" ? "biweekly" : "monthly";
    setStartDate(dates.start);
    setEndDate(dates.end);
    setPeriodType(periodTypeForPreset);
    await handleCreatePeriodFor(dates.start, dates.end, periodTypeForPreset);
  }

  async function handleCreatePeriodFor(start: string, end: string, type: PeriodType) {
    if (!start || !end) return;
    const scopedProfiles = workerFilter
      ? profiles.filter((profile) => profile.id === workerFilter)
      : profiles;
    const lines = buildWorkerLines(scopedProfiles, sessions, start, end, hasGpsBySessionId);
    const label = `${start} → ${end}`;

    if (AUTH_BYPASS_ENABLED) {
      // Date.now() is fine here — this runs from a click handler, not render.
      setPeriod({ id: `period-${Date.now()}`, label, startDate: start, endDate: end, type, status: "draft", lines });
      setShowNewPeriod(false);
      return;
    }

    if (!(await confirmNoOverlap(start, end))) {
      return;
    }

    const { data: periodRow, error: pErr } = await supabase
      .from("pay_periods")
      .insert({
        org_id: orgId,
        label,
        start_date: start,
        end_date: end,
        period_type: type,
        status: "draft",
        created_by: managerId,
      })
      .select("id")
      .single();

    if (pErr || !periodRow) {
      setError(pErr?.message ?? "Failed to create period");
      return;
    }

    const periodId = (periodRow as { id: string }).id;
    const itemRows = lines.filter((l) => l.hasHours).map((l) => ({
      pay_period_id: periodId,
      worker_id: l.workerId,
      rate: l.rate,
      regular_hours: l.regHours,
      overtime_hours: l.otHours,
      overtime_multiplier: OT_MULTIPLIER,
      gross_regular: l.grossRegular,
      gross_overtime: l.grossOt,
      gross_total: l.grossTotal,
      net_total: l.netTotal,
      adjustments_json: [],
      status: "pending",
    }));

    if (itemRows.length > 0) {
      const { error: iErr } = await supabase.from("pay_period_items").insert(itemRows);
      if (iErr) {
        setError(iErr.message);
        return;
      }
    }

    await loadPeriod(periodId);
    setSavedPeriods((prev) => [{ id: periodId, label, status: "draft" }, ...prev]);
    setShowNewPeriod(false);
    setError("");
  }

  async function confirmNoOverlap(start: string, end: string): Promise<boolean> {
    // Block silent overwrites: if any existing pay_period for this org
    // overlaps the requested window, surface them and require a manual
    // confirmation before creating a new one. We never delete or update
    // the existing rows — duplicate creation is the only failure mode,
    // and this guard makes it explicit.
    const { data: overlapping } = await supabase
      .from("pay_periods")
      .select("id, label, status")
      .eq("org_id", orgId)
      .lte("start_date", end)
      .gte("end_date", start);
    if (!overlapping || overlapping.length === 0) {
      return true;
    }
    const summary = (overlapping as Array<{ label: string; status: string }>)
      .map((p) => `• ${p.label} (${p.status})`)
      .join("\n");
    return window.confirm(
      t("payroll.overlapConfirm")
        .replace("{start}", start)
        .replace("{end}", end)
        .replace("{summary}", summary),
    );
  }

  async function handleCreatePeriod() {
    if (!startDate || !endDate) return;
    const scopedProfiles = workerFilter
      ? profiles.filter((profile) => profile.id === workerFilter)
      : profiles;
    const lines = buildWorkerLines(scopedProfiles, sessions, startDate, endDate, hasGpsBySessionId);
    const label = `${startDate} → ${endDate}`;

    if (AUTH_BYPASS_ENABLED) {
      setPeriod({ id: `period-${Date.now()}`, label, startDate, endDate, type: periodType, status: "draft", lines });
      setShowNewPeriod(false);
      return;
    }

    if (!(await confirmNoOverlap(startDate, endDate))) {
      return;
    }

    // Insert pay_period
    const { data: periodRow, error: pErr } = await supabase
      .from("pay_periods")
      .insert({
        org_id: orgId,
        label,
        start_date: startDate,
        end_date: endDate,
        period_type: periodType,
        status: "draft",
        created_by: managerId,
      })
      .select("id")
      .single();

    if (pErr || !periodRow) {
      setError(pErr?.message ?? "Failed to create period");
      return;
    }

    const periodId = (periodRow as { id: string }).id;

    // Insert items
    const itemRows = lines.filter((l) => l.hasHours).map((l) => ({
      pay_period_id: periodId,
      worker_id: l.workerId,
      rate: l.rate,
      regular_hours: l.regHours,
      overtime_hours: l.otHours,
      overtime_multiplier: OT_MULTIPLIER,
      gross_regular: l.grossRegular,
      gross_overtime: l.grossOt,
      gross_total: l.grossTotal,
      net_total: l.netTotal,
      adjustments_json: [],
      status: "pending",
    }));

    if (itemRows.length > 0) {
      const { error: iErr } = await supabase.from("pay_period_items").insert(itemRows);
      if (iErr) {
        setError(iErr.message);
        return;
      }
    }

    // Reload from DB to get item IDs
    await loadPeriod(periodId);
    setSavedPeriods((prev) => [{ id: periodId, label, status: "draft" }, ...prev]);
    setShowNewPeriod(false);
    setError("");
  }

  async function addAdjustment() {
    if (!period || !adjWorker || !adjAmount) return;
    const amount = Number.parseFloat(adjAmount);
    if (!Number.isFinite(amount) || amount === 0) return;

    const adj: Adjustment = { id: `adj-${Date.now()}`, type: adjType, amount, note: adjNote };

    setPeriod((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((l) => {
          if (l.workerId !== adjWorker) return l;
          const adjs = [...l.adjustments, adj];
          const bonus = adjs.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
          const reimb = adjs.filter((a) => a.type === "reimbursement").reduce((s, a) => s + a.amount, 0);
          const deduct = adjs.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
          const netTotal = r2(l.grossTotal + bonus + reimb - deduct);

          // Persist to DB
          if (!AUTH_BYPASS_ENABLED && l.itemId) {
            void supabase.from("pay_period_items").update({
              adjustments_json: adjs,
              bonus_amount: bonus,
              reimbursement_amount: reimb,
              deduction_amount: deduct,
              net_total: netTotal,
            }).eq("id", l.itemId);
          }

          return { ...l, adjustments: adjs, netTotal };
        }),
      };
    });
    setAdjWorker(null);
    setAdjAmount("");
    setAdjNote("");
  }

  function removeAdjustment(workerId: string, adjId: string) {
    setPeriod((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        lines: prev.lines.map((l) => {
          if (l.workerId !== workerId) return l;
          const adjs = l.adjustments.filter((a) => a.id !== adjId);
          const bonus = adjs.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
          const reimb = adjs.filter((a) => a.type === "reimbursement").reduce((s, a) => s + a.amount, 0);
          const deduct = adjs.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
          const netTotal = r2(l.grossTotal + bonus + reimb - deduct);

          if (!AUTH_BYPASS_ENABLED && l.itemId) {
            void supabase.from("pay_period_items").update({
              adjustments_json: adjs,
              bonus_amount: bonus,
              reimbursement_amount: reimb,
              deduction_amount: deduct,
              net_total: netTotal,
            }).eq("id", l.itemId);
          }

          return { ...l, adjustments: adjs, netTotal };
        }),
      };
    });
  }

  async function approveAll() {
    if (!period) return;
    const previous = period;

    // Optimistic flip so the buttons re-render immediately ("Approve All"
    // → "Mark All Paid"). Roll back if the DB writes fail.
    setPeriod((prev) =>
      prev ? { ...prev, status: "approved", lines: prev.lines.map((l) => ({ ...l, status: "approved" })) } : prev,
    );

    if (!AUTH_BYPASS_ENABLED) {
      const { error: pErr } = await supabase.from("pay_periods").update({
        status: "approved",
        approved_by: managerId,
        approved_at: new Date().toISOString(),
      }).eq("id", period.id);

      if (pErr) { setPeriod(previous); setError(pErr.message); return; }

      const { error: iErr } = await supabase
        .from("pay_period_items")
        .update({ status: "approved" })
        .eq("pay_period_id", period.id);
      if (iErr) { setPeriod(previous); setError(iErr.message); return; }
    }
    updateSavedPeriodStatus(period.id, "approved");

    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "payroll_approved",
      targetType: "pay_period",
      targetId: period.id,
      beforeData: { status: "draft" },
      afterData: { status: "approved", label: period.label },
    });
  }

  function updateSavedPeriodStatus(periodId: string, status: PeriodStatus) {
    setSavedPeriods((prev) =>
      prev.map((item) => (item.id === periodId ? { ...item, status } : item)),
    );
  }

  function periodStatusUpdate(status: PeriodStatus, nowIso: string) {
    if (status === "approved") {
      return { status, approved_by: managerId, approved_at: nowIso };
    }
    if (status === "paid") {
      return { status, paid_at: nowIso };
    }
    return { status };
  }

  // Bridge between the two payroll models. pay_periods/pay_period_items is
  // the canonical review screen. payroll_runs + payroll_line_items +
  // payroll_closures is the immutable ledger: archive/reporting read the
  // line items, and overview unpaid totals read the closures.
  async function mirrorPaidToPayrollLedger(workerIds: string[]): Promise<string | null> {
    if (AUTH_BYPASS_ENABLED) return null;
    if (!period) return null;
    if (workerIds.length === 0) return null;

    const ledgerWorkerIds = getPaidWorkerIdsAfter(period.lines, workerIds);
    const ledgerLines = buildPayrollLedgerLineDrafts(period.lines, ledgerWorkerIds);
    if (ledgerLines.length === 0) return null;

    const totals = ledgerLines.reduce(
      (acc, line) => {
        acc.hours += line.hours;
        acc.amount += line.amount;
        return acc;
      },
      { hours: 0, amount: 0 },
    );

    const { data: existing } = await supabase
      .from("payroll_runs")
      .select("id")
      .eq("org_id", orgId)
      .filter("metadata->>pay_period_id", "eq", period.id)
      .limit(1)
      .maybeSingle<{ id: string }>();

    let runId = existing?.id ?? null;

    if (!runId) {
      const { data: inserted, error: runErr } = await supabase
        .from("payroll_runs")
        .insert({
          org_id: orgId,
          run_by: managerId,
          period_start: period.startDate,
          period_end: period.endDate,
          status: "confirmed",
          total_hours: r2(totals.hours),
          total_amount: r2(totals.amount),
          confirmed_at: new Date().toISOString(),
          metadata: { pay_period_id: period.id, source: "pay_periods_bridge" },
        })
        .select("id")
        .single<{ id: string }>();
      if (runErr || !inserted) {
        return runErr?.message ?? "payroll_runs insert returned no row";
      }
      runId = inserted.id;
    } else {
      const { error: runUpdateErr } = await supabase
        .from("payroll_runs")
        .update({
          total_hours: r2(totals.hours),
          total_amount: r2(totals.amount),
        })
        .eq("id", runId);
      if (runUpdateErr) return runUpdateErr.message;
    }
    if (!runId) return "payroll_runs insert returned no row";

    const { data: existingLineItems, error: existingItemsErr } = await supabase
      .from("payroll_line_items")
      .select("profile_id, project_id")
      .eq("payroll_run_id", runId)
      .in("profile_id", ledgerWorkerIds)
      .returns<Array<{ profile_id: string; project_id: string | null }>>();
    if (existingItemsErr) return existingItemsErr.message;

    const existingLineKeys = new Set(
      (existingLineItems ?? []).map((item) => `${item.profile_id}:${item.project_id ?? ""}`),
    );
    const lineRows = ledgerLines
      .filter((line) => !existingLineKeys.has(`${line.profileId}:${line.projectId ?? ""}`))
      .map((line) => ({
        payroll_run_id: runId,
        profile_id: line.profileId,
        project_id: line.projectId,
        hours: line.hours,
        rate: line.rate,
        amount: line.amount,
        event_ids: line.eventIds,
        metadata: {
          pay_period_id: period.id,
          session_ids: line.sessionIds,
        },
      }));

    if (lineRows.length > 0) {
      const { error: lineErr } = await supabase
        .from("payroll_line_items")
        .insert(lineRows);
      if (lineErr) return lineErr.message;
    }

    const closedThrough = `${period.endDate}T23:59:59Z`;
    const { data: existingClosures, error: existingClosuresErr } = await supabase
      .from("payroll_closures")
      .select("profile_id")
      .eq("payroll_run_id", runId)
      .in("profile_id", ledgerWorkerIds)
      .returns<Array<{ profile_id: string }>>();
    if (existingClosuresErr) return existingClosuresErr.message;

    const closedWorkerIds = new Set((existingClosures ?? []).map((row) => row.profile_id));
    const closureRows = ledgerWorkerIds
      .filter((wid) => !closedWorkerIds.has(wid))
      .map((wid) => ({
        org_id: orgId,
        payroll_run_id: runId,
        profile_id: wid,
        closed_through: closedThrough,
      }));

    if (closureRows.length === 0) return null;

    const { error: closeErr } = await supabase
      .from("payroll_closures")
      .insert(closureRows);
    return closeErr?.message ?? null;
  }

  async function markAllPaid() {
    if (!period) return;
    const previous = period;

    setPeriod((prev) =>
      prev ? { ...prev, status: "paid", lines: prev.lines.map((l) => ({ ...l, status: "paid" })) } : prev,
    );

    if (!AUTH_BYPASS_ENABLED) {
      const { error: pErr } = await supabase.from("pay_periods").update({
        status: "paid",
        paid_at: new Date().toISOString(),
      }).eq("id", period.id);

      if (pErr) { setPeriod(previous); setError(pErr.message); return; }

      const { error: iErr } = await supabase
        .from("pay_period_items")
        .update({ status: "paid" })
        .eq("pay_period_id", period.id);
      if (iErr) { setPeriod(previous); setError(iErr.message); return; }

      // Mirror the paid transition into the ledger so archive/reporting
      // and overview unpaid totals agree with the pay period state.
      const mirrorErr = await mirrorPaidToPayrollLedger(
        period.lines.map((l) => l.workerId),
      );
      if (mirrorErr) {
        setError(`${t("payroll.ledgerMirrorFailed")}: ${mirrorErr}`);
        return;
      }
    }
    updateSavedPeriodStatus(period.id, "paid");

    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: "payroll_paid",
      targetType: "pay_period",
      targetId: period.id,
      beforeData: { status: "approved" },
      afterData: { status: "paid", label: period.label },
    });
  }

  function toggleSelect(workerId: string) {
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(workerId)) next.delete(workerId);
      else next.add(workerId);
      return next;
    });
  }

  function toggleSelectAll(eligible: WorkerLine[]) {
    setSelectedIds((current) => {
      if (current.size >= eligible.length) return new Set();
      return new Set(eligible.map((l) => l.workerId));
    });
  }

  async function processSelected() {
    if (!period) return;
    // Per spec — never act outside what the manager can currently see.
    // visibleSelectedIds is selectedIds ∩ visibleLines.workerId; we
    // pass the intersection rather than selectedIds so a stale
    // selection from a previous filter cannot leak through.
    if (visibleSelectedIds.size === 0) return;

    const ids = [...visibleSelectedIds];
    const selectedLines = period.lines.filter((line) =>
      visibleSelectedIds.has(line.workerId),
    );
    const nextStatus: ItemStatus =
      selectedLines.length > 0 &&
      selectedLines.every((line) => line.status === "approved")
        ? "paid"
        : "approved";
    const nextLines = period.lines.map((line) =>
      visibleSelectedIds.has(line.workerId)
        ? { ...line, status: nextStatus }
        : line,
    );
    const nextPeriodStatus = rollupPayPeriodStatus(nextLines);

    if (!AUTH_BYPASS_ENABLED) {
      const { error: itemErr } = await supabase
        .from("pay_period_items")
        .update({ status: nextStatus })
        .eq("pay_period_id", period.id)
        .in("worker_id", ids);
      if (itemErr) {
        setError(itemErr.message);
        return;
      }

      if (nextStatus === "paid") {
        const mirrorErr = await mirrorPaidToPayrollLedger(ids);
        if (mirrorErr) {
          setError(`${t("payroll.ledgerMirrorFailed")}: ${mirrorErr}`);
          return;
        }
      }

      if (nextPeriodStatus !== period.status) {
        const { error: periodErr } = await supabase
          .from("pay_periods")
          .update(periodStatusUpdate(nextPeriodStatus, new Date().toISOString()))
          .eq("id", period.id);
        if (periodErr) {
          setError(periodErr.message);
          return;
        }
      }
    }

    setPeriod((prev) =>
      prev
        ? {
            ...prev,
            status: nextPeriodStatus,
            lines: nextLines,
          }
        : prev,
    );
    if (nextPeriodStatus !== period.status) {
      updateSavedPeriodStatus(period.id, nextPeriodStatus);
    }
    setSelectedIds(new Set());

    void logAudit({
      orgId,
      actorId: managerId,
      actorName: managerName,
      actorRole: managerRole,
      action: nextStatus === "paid" ? "payroll_paid" : "payroll_approved",
      targetType: "pay_period_items",
      targetId: period.id,
      beforeData: { count: ids.length, status: period.status },
      afterData: { count: ids.length, status: nextStatus, workerIds: ids },
    });
  }

  function exportCsv() {
    if (!period) return;
    const csv = generateCsv(period);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `payroll-${period.startDate}-${period.endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  async function downloadPaystub(line: WorkerLine) {
    if (!period) return;
    const { jsPDF } = await import("jspdf");
    const autoTable = (await import("jspdf-autotable")).default;

    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const pageWidth = doc.internal.pageSize.getWidth();
    const gold: [number, number, number] = [191, 162, 52];
    const darkText: [number, number, number] = [30, 30, 30];
    const mutedText: [number, number, number] = [100, 100, 100];

    doc.setFillColor(...gold);
    doc.rect(0, 0, pageWidth, 18, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(255, 255, 255);
    doc.text("Andrew's Crew \u2014 Paystub", 14, 12);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(...mutedText);
    doc.text(`Pay Period: ${period.startDate} to ${period.endDate}`, 14, 26);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    doc.setTextColor(...darkText);
    doc.text(line.workerName, 14, 34);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...mutedText);
    doc.text(line.workerRole, 14, 39);

    autoTable(doc, {
      startY: 46,
      head: [["Item", "Hours", "Rate", "Amount"]],
      body: [
        ["Regular hours", line.regHours.toFixed(2), `$${line.rate.toFixed(2)}`, `$${line.grossRegular.toFixed(2)}`],
        ["Overtime (1.5x)", line.otHours.toFixed(2), `$${(line.rate * OT_MULTIPLIER).toFixed(2)}`, `$${line.grossOt.toFixed(2)}`],
        [{ content: "Gross pay", colSpan: 3, styles: { fontStyle: "bold", halign: "right" } }, { content: `$${line.grossTotal.toFixed(2)}`, styles: { fontStyle: "bold" } }],
      ],
      styles: { fontSize: 9, cellPadding: 3, textColor: darkText, lineColor: [220, 220, 220], lineWidth: 0.2 },
      headStyles: { fillColor: gold, textColor: [255, 255, 255], fontStyle: "bold" },
      margin: { left: 14, right: 14 },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let currentY = (doc as any).lastAutoTable.finalY + 8;

    if (line.adjustments.length > 0) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(10);
      doc.setTextColor(...gold);
      doc.text("Adjustments", 14, currentY);
      autoTable(doc, {
        startY: currentY + 2,
        head: [["Type", "Note", "Amount"]],
        body: line.adjustments.map((adj) => [
          adj.type,
          adj.note || "-",
          `${adj.type === "deduction" ? "-" : "+"}$${adj.amount.toFixed(2)}`,
        ]),
        styles: { fontSize: 9, cellPadding: 3, textColor: darkText, lineColor: [220, 220, 220], lineWidth: 0.2 },
        headStyles: { fillColor: gold, textColor: [255, 255, 255], fontStyle: "bold" },
        margin: { left: 14, right: 14 },
      });
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      currentY = (doc as any).lastAutoTable.finalY + 8;
    }

    doc.setFillColor(248, 248, 248);
    doc.setDrawColor(220, 220, 220);
    doc.roundedRect(14, currentY, pageWidth - 28, 14, 2, 2, "FD");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...darkText);
    doc.text("Net pay", 20, currentY + 9);
    doc.setTextColor(...gold);
    doc.text(`$${line.netTotal.toFixed(2)}`, pageWidth - 20, currentY + 9, { align: "right" });

    const pageHeight = doc.internal.pageSize.getHeight();
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(...mutedText);
    doc.text("Generated by Construction Clock", 14, pageHeight - 8);

    const safeName = line.workerName.replace(/[^a-zA-Z0-9]+/g, "_");
    doc.save(`paystub_${safeName}_${period.startDate}_to_${period.endDate}.pdf`);
  }

  // Worker lines visible after the worker filter is applied. A blank
  // filter shows everything. Selection / bulk actions are scoped to
  // this slice — clicking "Select all" never reaches outside the
  // currently-visible workers.
  const visibleLines = useMemo(() => {
    if (!period) return [] as WorkerLine[];
    if (!workerFilter) return period.lines;
    return period.lines.filter((line) => line.workerId === workerFilter);
  }, [period, workerFilter]);

  const eligibleSelectableLines = useMemo(() => {
    return visibleLines.filter(
      (line) => line.hasHours && line.status !== "paid",
    );
  }, [visibleLines]);

  useEffect(() => {
    if (!workerFilter || eligibleSelectableLines.length !== 1) return;
    const onlyLine = eligibleSelectableLines[0];
    if (onlyLine.workerId !== workerFilter) return;
    setSelectedIds((current) => {
      if (current.size === 1 && current.has(workerFilter)) return current;
      return new Set([workerFilter]);
    });
  }, [workerFilter, eligibleSelectableLines]);

  // require_video is read once off the profiles array. The shift-row
  // helper uses it to flag missing-checkout-video on close.
  const requireVideoByProfileId = useMemo(() => {
    const map: Record<string, boolean> = {};
    for (const p of profiles) {
      map[p.id] = Boolean(p.require_video);
    }
    return map;
  }, [profiles]);

  // Worker disambiguation map — flags name collisions (the "two
  // Olivers" case) and supplies the role / id suffix so the worker
  // filter, the per-row name, and any future selectors all show the
  // same disambiguator instead of inventing their own.
  const workerLabels = useMemo(
    () =>
      buildWorkerDisambiguationMap(
        profiles.map((p) => ({
          id: p.id,
          name: p.name,
          role: p.role,
        })),
      ),
    [profiles],
  );
  const payrollWorkerOptions = useMemo(
    () =>
      profiles
        .filter((profile) =>
          profile.role === "worker" ||
          profile.role === "supervisor" ||
          profile.role === "driver" ||
          profile.role === "subcontractor",
        )
        .map((profile) => ({
          id: profile.id,
          label: formatWorkerDisplayLabel(
            {
              id: profile.id,
              name: profile.name,
              role: profile.role,
            },
            workerLabels.get(profile.id),
          ),
        })),
    [profiles, workerLabels],
  );

  // Pay/$ columns follow the same finance gate as the page itself:
  // owner/admin or explicit finance_access. Manager-tier roles without
  // finance still see operational hours/review status, but no dollars.

  // Shift-level rows derived from sessions + period dates + worker filter.
  // pay_period_items model is per-worker; this derivation gives the
  // review surface chronological visibility without changing persistence.
  const draftRows = useMemo<PayrollDraftRow[]>(() => {
    if (!period) return [];
    return buildPayrollDraftRows({
      sessions,
      hasGpsBySessionId,
      requireVideoByProfileId,
      startDate: period.startDate,
      endDate: period.endDate,
      profileId: workerFilter || undefined,
    });
  }, [period, sessions, hasGpsBySessionId, requireVideoByProfileId, workerFilter]);

  const workerGroups = useMemo(
    () => groupPayrollRowsByWorker(draftRows),
    [draftRows],
  );

  const dayGroups = useMemo(() => groupPayrollRowsByDay(draftRows), [draftRows]);

  // Selected ids that are also currently visible after the worker
  // filter. Per spec, bulk actions never reach outside what the manager
  // can see — even if a stale selection persists when the filter
  // changes, the "Process selected" button only counts/operates on the
  // intersection.
  const visibleSelectedIds = useMemo(() => {
    if (selectedIds.size === 0) return new Set<string>();
    const visibleSet = new Set(visibleLines.map((line) => line.workerId));
    const next = new Set<string>();
    for (const id of selectedIds) {
      if (visibleSet.has(id)) next.add(id);
    }
    return next;
  }, [selectedIds, visibleLines]);

  // "Selected total hours" reads PayrollDraftRow durations for the
  // currently-selected visible workers. Surfaces alongside the
  // bulk-action button so the manager sees what they're about to act on.
  const selectionSummary = useMemo(() => {
    if (visibleSelectedIds.size === 0) {
      return { count: 0, totalHours: 0 };
    }
    const filteredRows = draftRows.filter((row) =>
      visibleSelectedIds.has(row.profileId),
    );
    const sum = sumDraftRowMinutes(filteredRows);
    return { count: visibleSelectedIds.size, totalHours: sum.totalHours };
  }, [draftRows, visibleSelectedIds]);

  const selectedAction = useMemo<"approve" | "pay">(() => {
    if (!period || visibleSelectedIds.size === 0) return "approve";
    const selectedLines = period.lines.filter((line) =>
      visibleSelectedIds.has(line.workerId),
    );
    return selectedLines.length > 0 &&
      selectedLines.every((line) => line.status === "approved")
      ? "pay"
      : "approve";
  }, [period, visibleSelectedIds]);

  const selectedWorkerLine = useMemo(() => {
    if (!period || visibleSelectedIds.size !== 1) return null;
    const [workerId] = [...visibleSelectedIds];
    return period.lines.find((line) => line.workerId === workerId) ?? null;
  }, [period, visibleSelectedIds]);

  const selectedActionLabel = useMemo(() => {
    if (selectedAction === "pay") {
      const prefix =
        selectedWorkerLine && selectionSummary.count === 1
          ? `${t("payroll.completePayment")}: ${selectedWorkerLine.workerName}`
          : t("payroll.completePayment");
      const amount =
        showFinancialFields && selectedWorkerLine
          ? ` · ${currency.format(selectedWorkerLine.netTotal)}`
          : "";
      return selectionSummary.count > 0
        ? `${prefix} · ${selectionSummary.totalHours.toFixed(1)}h${amount}`
        : prefix;
    }

    return selectionSummary.count > 0
      ? `${t("payroll.approveSelected")} · ${selectionSummary.count} · ${selectionSummary.totalHours.toFixed(1)}h`
      : t("payroll.approveSelected");
  }, [
    selectedAction,
    selectedWorkerLine,
    selectionSummary.count,
    selectionSummary.totalHours,
    showFinancialFields,
    t,
  ]);

  const summary = useMemo(() => {
    if (!period) return null;
    const active = period.lines.filter((l) => l.hasHours);
    const regHours = active.reduce((s, l) => s + l.regHours, 0);
    const otHours = active.reduce((s, l) => s + l.otHours, 0);
    return {
      workers: active.length,
      totalHours: regHours + otHours,
      regHours,
      otHours,
      grossTotal: active.reduce((s, l) => s + l.grossTotal, 0),
      netTotal: active.reduce((s, l) => s + l.netTotal, 0),
      adjustments: active.reduce((s, l) => s + l.netTotal - l.grossTotal, 0),
    };
  }, [period]);

  const projectTotals = useMemo(() => {
    if (!period) return [];
    const map = new Map<string, { name: string; hours: number; amount: number }>();
    for (const line of period.lines) {
      for (const pb of line.projectBreakdown) {
        const existing = map.get(pb.projectName) ?? { name: pb.projectName, hours: 0, amount: 0 };
        existing.hours += pb.hours;
        existing.amount += pb.amount;
        map.set(pb.projectName, existing);
      }
    }
    return Array.from(map.values()).sort((a, b) => b.amount - a.amount);
  }, [period]);

  const statusColor = (s: PeriodStatus | ItemStatus) =>
    s === "paid" ? "var(--green)" : s === "approved" ? "var(--brand-yellow)" : "var(--text-muted)";

  return (
    <div className="space-y-5">
      {error ? (
        <div className="rounded-[var(--radius-md)] px-3 py-3 text-sm" style={{ background: "rgba(212, 81, 94, 0.12)", color: "var(--red)" }}>
          {error}
        </div>
      ) : null}

      {/* Period selector */}
      <section className="surface-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            {period ? (
              <div>
                <div className="text-lg font-bold text-[var(--text-primary)]">{period.label}</div>
                <span
                  className="mt-1 inline-block rounded-[var(--radius-pill)] px-2 py-0.5 text-[10px] font-semibold uppercase"
                  style={{ background: `color-mix(in srgb, ${statusColor(period.status)} 16%, transparent)`, color: statusColor(period.status) }}
                >
                  {t(`payroll.${period.status}` as Parameters<typeof t>[0])}
                </span>
              </div>
            ) : (
              <div className="text-sm text-[var(--text-secondary)]">{t("payroll.description")}</div>
            )}
          </div>
          <div className="flex items-center gap-2">
            {/* Saved periods dropdown */}
            {savedPeriods.length > 0 ? (
              <select
                onChange={(e) => { if (e.target.value) void loadPeriod(e.target.value); }}
                defaultValue=""
                className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] outline-none"
              >
                <option value="">{t("payroll.history")}</option>
                {savedPeriods.map((sp) => (
                  <option key={sp.id} value={sp.id}>{sp.label} ({sp.status})</option>
                ))}
              </select>
            ) : null}
            <Link
              href="/payroll/history"
              className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
              style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
            >
              {t("payroll.history")}
            </Link>
            <button
              type="button"
              onClick={() => setShowNewPeriod(true)}
              className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold"
              style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}
            >
              {t("payroll.newPeriod")}
            </button>
          </div>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[minmax(240px,360px)_1fr]">
          <label className="block">
            <span className="mb-1 block text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
              {t("payroll.workerFilterLabel")}
            </span>
            <select
              value={workerFilter}
              onChange={(event) => setWorkerFilter(event.target.value)}
              className="w-full rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none"
              aria-label={t("payroll.workerFilterLabel")}
            >
              <option value="">{t("payroll.workerFilterAll")}</option>
              {payrollWorkerOptions.map((worker) => (
                <option key={worker.id} value={worker.id}>
                  {worker.label}
                </option>
              ))}
            </select>
          </label>
          <div className="self-end text-xs text-[var(--text-secondary)]">
            {t("payroll.workerFilterCreateHint")}
          </div>
        </div>

        {/* Empty state with quick-pick presets */}
        {!period && !showNewPeriod ? (
          <div className="mt-6 flex flex-col items-center gap-4 py-6 text-center">
            <span
              className="flex h-14 w-14 items-center justify-center rounded-full"
              style={{ background: "rgba(191, 162, 52, 0.12)" }}
            >
              <Calculator size={26} style={{ color: "var(--brand-yellow)" }} />
            </span>
            <div className="space-y-1">
              <div className="text-base font-bold text-[var(--text-primary)]">
                {t("payroll.emptyHeadline")}
              </div>
              <p className="mx-auto max-w-[48ch] text-sm text-[var(--text-secondary)]">
                {t("payroll.emptyHelp")}
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {(["lastWeek", "last2Weeks", "thisMonth"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => void applyPresetAndCreate(p)}
                  className="rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold"
                  style={{
                    background: "rgba(191, 162, 52, 0.12)",
                    color: "var(--brand-yellow)",
                  }}
                >
                  {t(`payroll.${p}` as Parameters<typeof t>[0])}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setShowNewPeriod(true)}
                className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold"
                style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
              >
                {t("payroll.newCustom")}
              </button>
            </div>
          </div>
        ) : null}

        {showNewPeriod ? (
          <div className="mt-4 space-y-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-4">
            <div className="flex flex-wrap gap-2">
              {(["lastWeek", "last2Weeks", "thisMonth"] as const).map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => handlePreset(p)}
                  className="rounded-[var(--radius-sm)] border px-3 py-1.5 text-xs font-semibold"
                  style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
                >
                  {t(`payroll.${p}` as Parameters<typeof t>[0])}
                </button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <DateField label={t("payroll.startDate")} value={startDate} onChange={(e) => setStartDate(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none" />
              <DateField label={t("payroll.endDate")} value={endDate} onChange={(e) => setEndDate(e.target.value)} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none" />
              <select value={periodType} onChange={(e) => setPeriodType(e.target.value as PeriodType)} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none">
                <option value="weekly">{t("payroll.weekly")}</option>
                <option value="biweekly">{t("payroll.biweekly")}</option>
                <option value="semi-monthly">{t("payroll.semiMonthly")}</option>
                <option value="monthly">{t("payroll.monthly")}</option>
                <option value="custom">{t("payroll.custom")}</option>
              </select>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => void handleCreatePeriod()} disabled={!startDate || !endDate} className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}>
                {t("payroll.create")}
              </button>
              <button type="button" onClick={() => setShowNewPeriod(false)} className="rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
                {t("common.cancel")}
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {period && summary ? (
        <>
          {/* Summary row */}
          <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-7">
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.workers")}</div>
              <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{summary.workers}</div>
            </div>
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.totalHours")}</div>
              <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{summary.totalHours.toFixed(1)}h</div>
            </div>
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.regHours")}</div>
              <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{summary.regHours.toFixed(1)}h</div>
            </div>
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.otHours")}</div>
              <div className="mt-1 font-mono text-xl font-bold" style={{ color: summary.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{summary.otHours.toFixed(1)}h</div>
            </div>
            {/* Financial summary cards — owner / admin only. Manager and
                supervisor see the operational hours columns and the
                review/status surface; the dollar totals are hidden behind
                isOwnerRole(managerRole). The DB does not enforce this
                gate (RLS lets manager-tier roles read the rows), so the
                check is purely UI. */}
            {showFinancialFields ? (
              <>
                <div className="surface-card p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.grossPay")}</div>
                  <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{currency.format(summary.grossTotal)}</div>
                </div>
                <div className="surface-card p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.adjustments")}</div>
                  <div className="mt-1 font-mono text-xl font-bold" style={{ color: summary.adjustments !== 0 ? "var(--brand-yellow)" : "var(--text-primary)" }}>
                    {summary.adjustments >= 0 ? "+" : ""}{currency.format(summary.adjustments)}
                  </div>
                </div>
                <div className="surface-card p-3">
                  <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.netPay")}</div>
                  <div className="mt-1 font-mono text-xl font-bold text-[var(--brand-yellow)]">{currency.format(summary.netTotal)}</div>
                </div>
              </>
            ) : (
              <div className="surface-card flex items-center justify-center p-3 text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)] xl:col-span-3">
                {t("payroll.financialOwnerOnly")}
              </div>
            )}
          </section>

          {/* Bulk actions */}
          <section className="flex flex-wrap items-center gap-2">
            {!workerFilter && period.status === "draft" ? (
              <button type="button" onClick={() => void approveAll()} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(191, 162, 52, 0.3)", color: "var(--brand-yellow)" }}>
                {t("payroll.approveAll")}
              </button>
            ) : null}
            {!workerFilter && period.status === "approved" ? (
              <button type="button" onClick={() => void markAllPaid()} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(15, 168, 120, 0.3)", color: "var(--green)" }}>
                {t("payroll.markAllPaid")}
              </button>
            ) : null}
            {period.status !== "paid" ? (
              <button
                type="button"
                onClick={() => void processSelected()}
                disabled={selectionSummary.count === 0}
                className="rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
                style={{
                  background:
                    selectionSummary.count === 0
                      ? "var(--border-default)"
                      : selectedAction === "pay"
                        ? "var(--green)"
                        : "var(--brand-yellow)",
                  color: selectionSummary.count === 0 ? "var(--text-muted)" : "var(--text-inverse)",
                }}
              >
                {selectedActionLabel}
              </button>
            ) : null}
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
              <Download size={13} />
              {t("payroll.exportCsv")}
            </button>
            {selectionSummary.count > 0 && period.status !== "paid" ? (
              <span className="max-w-[56ch] text-xs text-[var(--text-secondary)]">
                {selectedAction === "pay"
                  ? t("payroll.finalPayHint")
                  : t("payroll.approveThenPayHint")}
              </span>
            ) : null}
          </section>

          {/* Tab switcher */}
          <section className="flex gap-1">
            <button type="button" onClick={() => setTab("workers")} className="rounded-t-[var(--radius-md)] px-4 py-2 text-sm font-semibold" style={{ background: tab === "workers" ? "var(--bg-card)" : "transparent", color: tab === "workers" ? "var(--text-primary)" : "var(--text-muted)" }}>
              {t("payroll.workers")}
            </button>
            <button type="button" onClick={() => setTab("projects")} className="rounded-t-[var(--radius-md)] px-4 py-2 text-sm font-semibold" style={{ background: tab === "projects" ? "var(--bg-card)" : "transparent", color: tab === "projects" ? "var(--text-primary)" : "var(--text-muted)" }}>
              {t("payroll.byProject")}
            </button>
          </section>

          {tab === "workers" ? (
            <>
              {/* Worker filter + view-mode controls. Filter is a plain
                  presentational narrowing — it never deletes or excludes
                  pay_period_items, only what the manager sees. */}
              <section className="surface-card flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <label className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("payroll.workerFilterLabel")}
                  </label>
                  <select
                    value={workerFilter}
                    onChange={(event) => setWorkerFilter(event.target.value)}
                    className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-1.5 text-xs text-[var(--text-primary)] outline-none"
                    aria-label={t("payroll.workerFilterLabel")}
                  >
                    <option value="">{t("payroll.workerFilterAll")}</option>
                    {period.lines
                      .filter((line) => line.hasHours)
                      .map((line) => (
                        <option key={line.workerId} value={line.workerId}>
                          {formatWorkerDisplayLabel(
                            {
                              id: line.workerId,
                              name: line.workerName,
                              role: line.workerRole as UserRole,
                            },
                            workerLabels.get(line.workerId),
                          )}
                        </option>
                      ))}
                    {workerFilter &&
                    !period.lines.some((line) => line.workerId === workerFilter) ? (
                      <option value={workerFilter}>
                        {profiles.find((profile) => profile.id === workerFilter)?.name ??
                          workerFilter.slice(0, 8)}
                      </option>
                    ) : null}
                  </select>
                  {workerFilter ? (
                    <span className="rounded-[var(--radius-pill)] bg-[rgba(191,162,52,0.12)] px-2 py-0.5 text-[10px] font-semibold text-[var(--brand-yellow)]">
                      {t("payroll.workerFilterActive")}
                    </span>
                  ) : null}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => setReviewMode("byWorker")}
                    aria-pressed={reviewMode === "byWorker"}
                    className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background:
                        reviewMode === "byWorker"
                          ? "var(--brand-yellow)"
                          : "transparent",
                      color:
                        reviewMode === "byWorker"
                          ? "var(--text-inverse)"
                          : "var(--text-secondary)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    {workerFilter
                      ? t("payroll.reviewModeList")
                      : t("payroll.reviewModeByWorker")}
                  </button>
                  <button
                    type="button"
                    onClick={() => setReviewMode("chronology")}
                    aria-pressed={reviewMode === "chronology"}
                    className="rounded-[var(--radius-sm)] px-3 py-1.5 text-xs font-semibold"
                    style={{
                      background:
                        reviewMode === "chronology"
                          ? "var(--brand-yellow)"
                          : "transparent",
                      color:
                        reviewMode === "chronology"
                          ? "var(--text-inverse)"
                          : "var(--text-secondary)",
                      border: "1px solid var(--border-default)",
                    }}
                  >
                    {t("payroll.reviewModeChronology")}
                  </button>
                </div>
              </section>

              {visibleLines.length === 0 ? (
                <section className="surface-card p-6 text-center text-sm text-[var(--text-secondary)]">
                  {workerFilter
                    ? t("payroll.emptyWorkerInPeriod")
                    : t("payroll.emptyPeriod")}
                </section>
              ) : reviewMode === "byWorker" ? (
                <section className="surface-card overflow-x-auto p-4">
                  {/* Aggregate per-worker line + a collapsible shift list
                      under each worker for chronological review. */}
                  <div className="flex items-center justify-between gap-3 pb-3">
                    <div className="flex items-center gap-2 text-xs text-[var(--text-secondary)]">
                      <input
                        type="checkbox"
                        aria-label={t("payroll.selectAll")}
                        checked={
                          eligibleSelectableLines.length > 0 &&
                          visibleSelectedIds.size === eligibleSelectableLines.length
                        }
                        ref={(el) => {
                          if (!el) return;
                          el.indeterminate =
                            visibleSelectedIds.size > 0 &&
                            visibleSelectedIds.size < eligibleSelectableLines.length;
                        }}
                        onChange={() => toggleSelectAll(eligibleSelectableLines)}
                        disabled={eligibleSelectableLines.length === 0}
                        className="h-4 w-4 accent-[var(--brand-yellow)]"
                      />
                      <span>{t("payroll.selectAllVisible")}</span>
                    </div>
                  </div>
                  <table className="w-full text-left text-sm">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                        <th className="pb-3 pr-2 font-semibold" />
                        <th className="pb-3 pr-3 font-semibold">{t("overview.colName")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.totalHours")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.regHours")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.otHours")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.noGpsHours")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("common.rate")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.grossPay")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.adjustments")}</th>
                        <th className="pb-3 pr-3 font-semibold">{t("payroll.netPay")}</th>
                        <th className="pb-3 font-semibold" />
                      </tr>
                    </thead>
                    <tbody>
                      {visibleLines.map((line) => {
                        const group = workerGroups.find(
                          (g) => g.profileId === line.workerId,
                        );
                        const isCollapsed = collapsedWorkerIds.has(line.workerId);
                        const reviewBlocked =
                          group !== undefined &&
                          (group.extremeShiftCount > 0 ||
                            group.missingCheckoutCount > 0);
                        const reviewWarn =
                          group !== undefined &&
                          (group.longShiftCount > 0 ||
                            group.missingVideoCount > 0 ||
                            group.transferGapCount > 0 ||
                            group.noGpsMinutes > 0);
                        const reviewState: "blocked" | "warn" | "clean" = reviewBlocked
                          ? "blocked"
                          : reviewWarn
                            ? "warn"
                            : "clean";
                        return (
                          <Fragment key={line.workerId}>
                            <tr
                              className="border-b border-[var(--border-subtle)]"
                              style={{ opacity: line.hasHours ? 1 : 0.4 }}
                            >
                              <td className="py-3 pr-2 align-top">
                                <input
                                  type="checkbox"
                                  aria-label={line.workerName}
                                  checked={selectedIds.has(line.workerId)}
                                  onChange={() => toggleSelect(line.workerId)}
                                  disabled={!line.hasHours || line.status === "paid"}
                                  className="h-4 w-4 accent-[var(--brand-yellow)]"
                                />
                              </td>
                              <td className="py-3 pr-3 align-top">
                                <div className="flex items-center gap-2">
                                  {group && group.rows.length > 0 ? (
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setCollapsedWorkerIds((prev) => {
                                          const next = new Set(prev);
                                          if (next.has(line.workerId))
                                            next.delete(line.workerId);
                                          else next.add(line.workerId);
                                          return next;
                                        });
                                      }}
                                      aria-label={
                                        isCollapsed
                                          ? t("payroll.expandShifts")
                                          : t("payroll.collapseShifts")
                                      }
                                      className="inline-flex h-5 w-5 items-center justify-center rounded-[var(--radius-sm)] text-[var(--text-muted)]"
                                    >
                                      {isCollapsed ? "▸" : "▾"}
                                    </button>
                                  ) : null}
                                  <span className="font-semibold text-[var(--text-primary)]">
                                    {formatWorkerDisplayLabel(
                                      {
                                        id: line.workerId,
                                        name: line.workerName,
                                        role: line.workerRole as UserRole,
                                      },
                                      workerLabels.get(line.workerId),
                                    )}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap gap-1">
                                  <span
                                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                                    style={{
                                      background: "rgba(191, 162, 52, 0.12)",
                                      color: "var(--brand-yellow)",
                                    }}
                                  >
                                    {line.workerRole}
                                  </span>
                                  <span
                                    className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]"
                                    style={
                                      reviewState === "blocked"
                                        ? { background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }
                                        : reviewState === "warn"
                                          ? { background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }
                                          : { background: "rgba(15, 168, 120, 0.14)", color: "var(--green)" }
                                    }
                                    title={
                                      reviewState === "blocked"
                                        ? t("payroll.reviewBlockedHint")
                                        : reviewState === "warn"
                                          ? t("payroll.reviewWarnHint")
                                          : t("payroll.reviewCleanHint")
                                    }
                                  >
                                    {reviewState === "blocked"
                                      ? t("payroll.reviewBlocked")
                                      : reviewState === "warn"
                                        ? t("payroll.reviewWarn")
                                        : t("payroll.reviewClean")}
                                  </span>
                                  {group && group.extremeShiftCount > 0 ? (
                                    <span
                                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
                                    >
                                      {group.extremeShiftCount} ≥24h
                                    </span>
                                  ) : null}
                                  {group && group.longShiftCount > 0 ? (
                                    <span
                                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
                                    >
                                      {group.longShiftCount} ≥16h
                                    </span>
                                  ) : null}
                                  {group && group.missingCheckoutCount > 0 ? (
                                    <span
                                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style={{ background: "rgba(212, 81, 94, 0.14)", color: "var(--red)" }}
                                    >
                                      {group.missingCheckoutCount} {t("payroll.missingCheckoutShort")}
                                    </span>
                                  ) : null}
                                  {group && group.missingVideoCount > 0 ? (
                                    <span
                                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
                                    >
                                      {group.missingVideoCount} {t("payroll.missingVideoShort")}
                                    </span>
                                  ) : null}
                                  {group && group.transferGapCount > 0 ? (
                                    <span
                                      className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-bold uppercase"
                                      style={{ background: "rgba(245, 158, 11, 0.14)", color: "#f59e0b" }}
                                    >
                                      {group.transferGapCount} {t("payroll.transferGapShort")}
                                    </span>
                                  ) : null}
                                </div>
                                {line.rate === 0 && line.hasHours ? <div className="mt-1 text-[10px] font-semibold" style={{ color: "#f59e0b" }}>{t("payroll.rateNotSet")}</div> : null}
                                {!line.hasHours ? <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t("payroll.noHours")}</div> : null}
                              </td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono font-bold text-[var(--text-primary)]">{(line.regHours + line.otHours).toFixed(1)}h</td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono text-[var(--text-primary)]">{line.regHours.toFixed(1)}h</td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono" style={{ color: line.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{line.otHours.toFixed(1)}h</td>
                              <td
                                className="py-3 pr-3 whitespace-nowrap align-top font-mono"
                                style={{ color: line.noGpsHours > 0 ? "#f59e0b" : "var(--text-muted)" }}
                                title={line.itemId && line.noGpsHours === 0 ? t("payroll.noGpsHoursLoadedHint") : undefined}
                              >
                                {line.itemId && line.noGpsHours === 0
                                  ? "—"
                                  : `${line.noGpsHours.toFixed(1)}h`}
                              </td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono text-[var(--text-secondary)]">${line.rate.toFixed(2)}</td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono font-semibold text-[var(--text-primary)]">{currency.format(line.grossTotal)}</td>
                              <td className="py-3 pr-3 align-top">
                                <div className="flex flex-wrap items-center gap-1">
                                  {line.adjustments.map((adj) => (
                                    <span key={adj.id} className="inline-flex items-center gap-1 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: adj.type === "deduction" ? "rgba(212, 81, 94, 0.12)" : "rgba(15, 168, 120, 0.12)", color: adj.type === "deduction" ? "var(--red)" : "var(--green)" }} title={adj.note}>
                                      {adj.type === "deduction" ? "-" : "+"}{currency.format(adj.amount)}
                                      {period.status === "draft" ? <button type="button" onClick={() => removeAdjustment(line.workerId, adj.id)} className="ml-0.5"><X size={10} /></button> : null}
                                    </span>
                                  ))}
                                  {period.status === "draft" ? (
                                    <button type="button" onClick={() => { setAdjWorker(line.workerId); setAdjType("bonus"); setAdjAmount(""); setAdjNote(""); }} className="inline-flex items-center gap-0.5 rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: "rgba(191, 162, 52, 0.08)", color: "var(--brand-yellow)" }}>
                                      <Plus size={10} />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                              <td className="py-3 pr-3 whitespace-nowrap align-top font-mono font-bold text-[var(--brand-yellow)]">{currency.format(line.netTotal)}</td>
                              <td className="py-3 align-top">
                                <div className="flex items-center gap-1.5">
                                  <span className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: `color-mix(in srgb, ${statusColor(line.status)} 16%, transparent)`, color: statusColor(line.status) }}>
                                    {t(`payroll.${line.status}` as Parameters<typeof t>[0])}
                                  </span>
                                  {line.hasHours ? (
                                    <button
                                      type="button"
                                      onClick={() => void downloadPaystub(line)}
                                      title={t("payroll.viewPaystub")}
                                      className="inline-flex h-6 w-6 items-center justify-center rounded-[var(--radius-sm)] border"
                                      style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}
                                    >
                                      <Download size={11} />
                                    </button>
                                  ) : null}
                                </div>
                              </td>
                            </tr>
                            {/* Shift detail rows under the worker. Hidden
                                when collapsed; always rendered when the
                                worker filter narrows to one person. */}
                            {!isCollapsed && group && group.rows.length > 0 ? (
                              <tr>
                                <td colSpan={11} className="bg-[var(--bg-primary)] px-3 py-2">
                                  <ShiftDetailList rows={group.rows} t={t} />
                                </td>
                              </tr>
                            ) : null}
                          </Fragment>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              ) : (
                /* Chronology mode — all visible shifts in one timeline,
                   bucketed by day. Worker name shown on each row. */
                <section className="surface-card p-4">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--text-muted)]">
                    {t("payroll.reviewModeChronology")}
                  </div>
                  {dayGroups.length === 0 ? (
                    <div className="mt-4 text-sm text-[var(--text-secondary)]">
                      {workerFilter
                        ? t("payroll.emptyWorkerInPeriod")
                        : t("payroll.emptyPeriod")}
                    </div>
                  ) : (
                    <div className="mt-3 space-y-4">
                      {dayGroups.map((day) => (
                        <div key={day.dayKey}>
                          <div className="flex items-center justify-between gap-2 border-b border-[var(--border-subtle)] pb-1">
                            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-[var(--text-secondary)]">
                              {day.dayKey}
                            </span>
                            <span className="font-mono text-xs text-[var(--text-muted)]">
                              {(day.totalMinutes / 60).toFixed(1)}h
                            </span>
                          </div>
                          <div className="mt-1 divide-y divide-[var(--border-subtle)]">
                            {day.rows.map((row) => (
                              <ShiftRow key={row.sessionId} row={row} t={t} showWorker />
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}
            </>
          ) : (
            <section className="surface-card p-4">
              <h2 className="text-lg font-bold text-[var(--text-primary)]">{t("payroll.byProject")}</h2>
              <div className="mt-4 space-y-2">
                {projectTotals.map((p) => (
                  <div key={p.name} className="flex items-center justify-between gap-3 rounded-[var(--radius-md)] border border-[var(--border-default)] p-3">
                    <div>
                      <div className="text-sm font-semibold text-[var(--text-primary)]">{p.name}</div>
                      <div className="mt-0.5 font-mono text-xs text-[var(--text-muted)]">{p.hours.toFixed(1)}h</div>
                    </div>
                    <div className="font-mono text-sm font-bold text-[var(--brand-yellow)]">{currency.format(p.amount)}</div>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="rounded-[var(--radius-md)] px-4 py-3 text-xs leading-5 text-[var(--text-muted)]" style={{ background: "var(--bg-primary)" }}>
            {t("payroll.taxDisclaimer")}
          </section>
        </>
      ) : null}

      {/* Adjustment modal */}
      {adjWorker ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.6)" }}>
          <div className="w-full max-w-[360px] rounded-[16px] p-5" style={{ background: "var(--bg-surface)", border: "1px solid var(--border-default)" }}>
            <h3 className="text-base font-bold text-[var(--text-primary)]">{t("payroll.addAdjustment")}</h3>
            <div className="mt-3 grid gap-3">
              <select value={adjType} onChange={(e) => setAdjType(e.target.value as AdjType)} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none">
                <option value="bonus">{t("payroll.bonus")}</option>
                <option value="reimbursement">{t("payroll.reimbursement")}</option>
                <option value="deduction">{t("payroll.deduction")}</option>
              </select>
              <input type="number" step="0.01" value={adjAmount} onChange={(e) => setAdjAmount(e.target.value)} placeholder="$0.00" className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none" />
              <TextInputWithVoice value={adjNote} onChange={(e) => setAdjNote(e.target.value)} placeholder={t("payroll.adjustmentNotePlaceholder")} className="rounded-[var(--radius-md)] border border-[var(--border-default)] bg-[var(--bg-primary)] px-3 py-2.5 text-sm text-[var(--text-primary)] outline-none" />
              <div className="flex gap-2">
                <button type="button" onClick={() => void addAdjustment()} className="flex-1 rounded-[var(--radius-sm)] px-4 py-2.5 text-sm font-semibold" style={{ background: "var(--brand-yellow)", color: "var(--text-inverse)" }}>
                  {t("payroll.addAdjustment")}
                </button>
                <button type="button" onClick={() => setAdjWorker(null)} className="flex-1 rounded-[var(--radius-sm)] border px-4 py-2.5 text-sm font-semibold" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
                  {t("common.cancel")}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
