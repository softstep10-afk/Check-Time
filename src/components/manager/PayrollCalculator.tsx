"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Calculator, Download, Plus, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { AUTH_BYPASS_ENABLED } from "@/lib/auth-bypass";
import { useTranslation } from "@/lib/i18n";
import { DateField } from "@/components/shared/DateField";
import { TextInputWithVoice } from "@/components/shared/TextInputWithVoice";
import { logAudit } from "@/lib/audit";
import type { Profile } from "@/types/database";
import type { ManagerSession } from "@/lib/manager-types";

// ── Types ──

type PeriodType = "weekly" | "biweekly" | "semi-monthly" | "monthly" | "custom";
type PeriodStatus = "draft" | "approved" | "paid";
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
  grossRegular: number;
  grossOt: number;
  adjustments: Adjustment[];
  grossTotal: number;
  netTotal: number;
  status: PeriodStatus;
  hasHours: boolean;
  projectBreakdown: Array<{ projectName: string; hours: number; amount: number }>;
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

function computeNet(line: { grossTotal: number; adjustments: Adjustment[] }): number {
  const bonus = line.adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
  const reimb = line.adjustments.filter((a) => a.type === "reimbursement").reduce((s, a) => s + a.amount, 0);
  const deduct = line.adjustments.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
  return r2(line.grossTotal + bonus + reimb - deduct);
}

function buildWorkerLines(
  profiles: Profile[],
  sessions: ManagerSession[],
  startDate: string,
  endDate: string,
): WorkerLine[] {
  const startMs = new Date(`${startDate}T00:00:00`).getTime();
  const endMs = new Date(`${endDate}T23:59:59`).getTime();

  const hoursByWorker = new Map<string, { total: number; byProject: Map<string, { name: string; minutes: number }> }>();

  for (const s of sessions) {
    const sStart = new Date(s.clockInTime).getTime();
    const sEnd = s.clockOutTime ? new Date(s.clockOutTime).getTime() : Date.now();
    const effStart = Math.max(sStart, startMs);
    const effEnd = Math.min(sEnd, endMs);
    if (effEnd <= effStart) continue;

    const minutes = Math.round((effEnd - effStart) / 60_000);
    const entry = hoursByWorker.get(s.profileId) ?? { total: 0, byProject: new Map() };
    entry.total += minutes;
    const proj = entry.byProject.get(s.projectId) ?? { name: s.projectName, minutes: 0 };
    proj.minutes += minutes;
    entry.byProject.set(s.projectId, proj);
    hoursByWorker.set(s.profileId, entry);
  }

  return profiles
    .filter((p) => !p.deleted_at)
    .map((p) => {
      const data = hoursByWorker.get(p.id);
      const totalHours = data ? r2(data.total / 60) : 0;
      const { reg, ot } = computeOt(totalHours);
      const rate = Number(p.hourly_rate ?? 0);
      const grossReg = r2(reg * rate);
      const grossOt = r2(ot * rate * OT_MULTIPLIER);
      const grossTotal = grossReg + grossOt;

      const projectBreakdown = data
        ? Array.from(data.byProject.entries()).map(([, v]) => ({
            projectName: v.name,
            hours: r2(v.minutes / 60),
            amount: r2((v.minutes / 60) * rate),
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
        grossRegular: grossReg,
        grossOt,
        adjustments: [],
        grossTotal,
        netTotal: grossTotal,
        status: "draft" as PeriodStatus,
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
  const headers = "Name,Role,Reg Hours,OT Hours,Rate,Gross Reg,Gross OT,Bonus,Reimbursement,Deduction,Net,Period Start,Period End";
  const rows = period.lines
    .filter((l) => l.hasHours)
    .map((l) => {
      const bonus = l.adjustments.filter((a) => a.type === "bonus").reduce((s, a) => s + a.amount, 0);
      const reimb = l.adjustments.filter((a) => a.type === "reimbursement").reduce((s, a) => s + a.amount, 0);
      const deduct = l.adjustments.filter((a) => a.type === "deduction").reduce((s, a) => s + a.amount, 0);
      return `"${l.workerName}","${l.workerRole}",${l.regHours},${l.otHours},${l.rate},${l.grossRegular},${l.grossOt},${bonus},${reimb},${deduct},${l.netTotal},"${period.startDate}","${period.endDate}"`;
    });
  return [headers, ...rows].join("\n");
}

// ── Component ──

export function PayrollCalculator({
  orgId,
  managerId,
  managerName,
  managerRole,
  profiles,
  sessions,
}: {
  orgId: string;
  managerId: string;
  managerName: string;
  managerRole: string;
  profiles: Profile[];
  sessions: ManagerSession[];
}) {
  const { t } = useTranslation();
  const supabase = useMemo(() => createClient(), []);
  const searchParams = useSearchParams();
  const [showNewPeriod, setShowNewPeriod] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [periodType, setPeriodType] = useState<PeriodType>("biweekly");
  const [period, setPeriod] = useState<PayPeriod | null>(null);
  const [savedPeriods, setSavedPeriods] = useState<Array<{ id: string; label: string; status: string }>>([]);
  const [tab, setTab] = useState<"workers" | "projects">("workers");
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
        grossRegular: Number(item.gross_regular),
        grossOt: Number(item.gross_overtime),
        adjustments: (item.adjustments_json ?? []) as Adjustment[],
        grossTotal: Number(item.gross_total),
        netTotal: Number(item.net_total),
        status: item.status as PeriodStatus,
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
    const lines = buildWorkerLines(profiles, sessions, start, end);
    const label = `${start} → ${end}`;

    if (AUTH_BYPASS_ENABLED) {
      // Date.now() is fine here — this runs from a click handler, not render.
      // eslint-disable-next-line react-hooks/purity
      setPeriod({ id: `period-${Date.now()}`, label, startDate: start, endDate: end, type, status: "draft", lines });
      setShowNewPeriod(false);
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

  async function handleCreatePeriod() {
    if (!startDate || !endDate) return;
    const lines = buildWorkerLines(profiles, sessions, startDate, endDate);
    const label = `${startDate} → ${endDate}`;

    if (AUTH_BYPASS_ENABLED) {
      setPeriod({ id: `period-${Date.now()}`, label, startDate, endDate, type: periodType, status: "draft", lines });
      setShowNewPeriod(false);
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
    }

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
    if (selectedIds.size === 0) return;

    const ids = [...selectedIds];
    const nextStatus: PeriodStatus = period.status === "draft" ? "approved" : "paid";

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
    }

    setPeriod((prev) =>
      prev
        ? {
            ...prev,
            lines: prev.lines.map((line) =>
              selectedIds.has(line.workerId) ? { ...line, status: nextStatus } : line,
            ),
          }
        : prev,
    );
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

  const eligibleSelectableLines = useMemo(() => {
    if (!period) return [] as WorkerLine[];
    return period.lines.filter((line) => line.hasHours && line.status !== "paid");
  }, [period]);

  const summary = useMemo(() => {
    if (!period) return null;
    const active = period.lines.filter((l) => l.hasHours);
    return {
      workers: active.length,
      regHours: active.reduce((s, l) => s + l.regHours, 0),
      otHours: active.reduce((s, l) => s + l.otHours, 0),
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

  const statusColor = (s: PeriodStatus) =>
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
          <section className="grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.workers")}</div>
              <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{summary.workers}</div>
            </div>
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.regHours")}</div>
              <div className="mt-1 font-mono text-xl font-bold text-[var(--text-primary)]">{summary.regHours.toFixed(1)}h</div>
            </div>
            <div className="surface-card p-3">
              <div className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]">{t("payroll.otHours")}</div>
              <div className="mt-1 font-mono text-xl font-bold" style={{ color: summary.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{summary.otHours.toFixed(1)}h</div>
            </div>
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
          </section>

          {/* Bulk actions */}
          <section className="flex flex-wrap items-center gap-2">
            {period.status === "draft" ? (
              <button type="button" onClick={() => void approveAll()} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(191, 162, 52, 0.3)", color: "var(--brand-yellow)" }}>
                {t("payroll.approveAll")}
              </button>
            ) : null}
            {period.status === "approved" ? (
              <button type="button" onClick={() => void markAllPaid()} className="rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "rgba(15, 168, 120, 0.3)", color: "var(--green)" }}>
                {t("payroll.markAllPaid")}
              </button>
            ) : null}
            {period.status !== "paid" ? (
              <button
                type="button"
                onClick={() => void processSelected()}
                disabled={selectedIds.size === 0}
                className="rounded-[var(--radius-sm)] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                style={{
                  background: selectedIds.size === 0 ? "var(--border-default)" : "var(--brand-yellow)",
                  color: selectedIds.size === 0 ? "var(--text-muted)" : "var(--text-inverse)",
                }}
              >
                {t("payroll.processSelected")}
                {selectedIds.size > 0 ? ` · ${selectedIds.size}` : ""}
              </button>
            ) : null}
            <button type="button" onClick={exportCsv} className="inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border px-3 py-2 text-xs font-semibold" style={{ borderColor: "var(--border-default)", color: "var(--text-secondary)" }}>
              <Download size={13} />
              {t("payroll.exportCsv")}
            </button>
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
            <section className="surface-card overflow-x-auto p-4">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="text-[10px] uppercase tracking-[0.16em] text-[var(--text-muted)]" style={{ borderBottom: "1px solid var(--border-default)" }}>
                    <th className="pb-3 pr-2 font-semibold">
                      <input
                        type="checkbox"
                        aria-label={t("payroll.selectAll")}
                        checked={
                          eligibleSelectableLines.length > 0 &&
                          selectedIds.size === eligibleSelectableLines.length
                        }
                        ref={(el) => {
                          if (!el) return;
                          el.indeterminate =
                            selectedIds.size > 0 &&
                            selectedIds.size < eligibleSelectableLines.length;
                        }}
                        onChange={() => toggleSelectAll(eligibleSelectableLines)}
                        disabled={eligibleSelectableLines.length === 0}
                        className="h-4 w-4 accent-[var(--brand-yellow)]"
                      />
                    </th>
                    <th className="pb-3 pr-3 font-semibold">{t("overview.colName")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.regHours")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.otHours")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("common.rate")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.grossPay")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.adjustments")}</th>
                    <th className="pb-3 pr-3 font-semibold">{t("payroll.netPay")}</th>
                    <th className="pb-3 font-semibold" />
                  </tr>
                </thead>
                <tbody>
                  {period.lines.map((line) => (
                    <tr key={line.workerId} className="border-b border-[var(--border-subtle)]" style={{ opacity: line.hasHours ? 1 : 0.4 }}>
                      <td className="py-3 pr-2">
                        <input
                          type="checkbox"
                          aria-label={line.workerName}
                          checked={selectedIds.has(line.workerId)}
                          onChange={() => toggleSelect(line.workerId)}
                          disabled={!line.hasHours || line.status === "paid"}
                          className="h-4 w-4 accent-[var(--brand-yellow)]"
                        />
                      </td>
                      <td className="py-3 pr-3">
                        <div className="font-semibold text-[var(--text-primary)]">{line.workerName}</div>
                        <span className="mt-0.5 inline-block rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ background: "rgba(191, 162, 52, 0.12)", color: "var(--brand-yellow)" }}>{line.workerRole}</span>
                        {line.rate === 0 && line.hasHours ? <div className="mt-1 text-[10px] font-semibold" style={{ color: "#f59e0b" }}>{t("payroll.rateNotSet")}</div> : null}
                        {!line.hasHours ? <div className="mt-1 text-[10px] text-[var(--text-muted)]">{t("payroll.noHours")}</div> : null}
                      </td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-[var(--text-primary)]">{line.regHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono" style={{ color: line.otHours > 0 ? "#f59e0b" : "var(--text-primary)" }}>{line.otHours.toFixed(1)}h</td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono text-[var(--text-secondary)]">${line.rate.toFixed(2)}</td>
                      <td className="py-3 pr-3 whitespace-nowrap font-mono font-semibold text-[var(--text-primary)]">{currency.format(line.grossTotal)}</td>
                      <td className="py-3 pr-3">
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
                      <td className="py-3 pr-3 whitespace-nowrap font-mono font-bold text-[var(--brand-yellow)]">{currency.format(line.netTotal)}</td>
                      <td className="py-3">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded-[var(--radius-pill)] px-1.5 py-0.5 text-[10px] font-semibold uppercase" style={{ background: `color-mix(in srgb, ${statusColor(line.status)} 16%, transparent)`, color: statusColor(line.status) }}>
                            {line.status}
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
                  ))}
                </tbody>
              </table>
            </section>
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
