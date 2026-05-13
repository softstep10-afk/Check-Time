import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

function loadEnv() {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    let value = match[2];
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (!(match[1] in process.env)) process.env[match[1]] = value;
  }
}

function groupDuplicates(rows, keyFn) {
  const groups = new Map();
  for (const row of rows ?? []) {
    const key = keyFn(row);
    const list = groups.get(key) ?? [];
    list.push(row);
    groups.set(key, list);
  }
  return [...groups.entries()]
    .filter(([, list]) => list.length > 1)
    .map(([key, list]) => ({ key, count: list.length, ids: list.map((row) => row.id ?? key) }));
}

function asArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

function dateMs(value) {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : null;
}

function endOfDateIso(value) {
  const d = new Date(`${value}T23:59:59.999Z`);
  return d.toISOString();
}

async function selectAll(supabase, table, columns) {
  const { data, error } = await supabase.from(table).select(columns);
  if (error) throw new Error(`${table}: ${error.message}`);
  return data ?? [];
}

loadEnv();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local");
  process.exit(2);
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const [
  payPeriods,
  payPeriodItems,
  payrollRuns,
  payrollLineItems,
  payrollClosures,
  tasks,
  media,
  projects,
  auditRows,
  userCapabilities,
] = await Promise.all([
  selectAll(supabase, "pay_periods", "id, org_id, label, start_date, end_date, status, paid_at, metadata"),
  selectAll(supabase, "pay_period_items", "id, pay_period_id, worker_id, status"),
  selectAll(supabase, "payroll_runs", "id, org_id, period_start, period_end, status, confirmed_at, metadata"),
  selectAll(supabase, "payroll_line_items", "id, payroll_run_id, profile_id, project_id, event_ids, metadata"),
  selectAll(supabase, "payroll_closures", "id, payroll_run_id, profile_id, closed_through"),
  selectAll(supabase, "tasks", "id, project_id, title, status, completed_at, deleted_at, metadata"),
  selectAll(supabase, "media", "id, project_id, uploaded_by, filename, metadata, deleted_at, time_event_id, is_checkout"),
  selectAll(supabase, "projects", "id, name, status, deleted_at, archived_at"),
  selectAll(supabase, "audit_log", "id, action, target_type, target_id, created_at"),
  selectAll(supabase, "user_capabilities", "user_id, capability, granted"),
]);

const payPeriodsById = new Map(payPeriods.map((period) => [period.id, period]));
const payrollRunsById = new Map(payrollRuns.map((run) => [run.id, run]));
const mediaById = new Map(media.map((item) => [item.id, item]));

const failures = [];
const warnings = [];
const notes = [];

function fail(name, detail) {
  failures.push({ name, detail });
}

function warn(name, detail) {
  warnings.push({ name, detail });
}

function note(name, detail) {
  notes.push({ name, detail });
}

const duplicatePayPeriodItems = groupDuplicates(
  payPeriodItems,
  (item) => `${item.pay_period_id}|${item.worker_id}`,
);
if (duplicatePayPeriodItems.length > 0) fail("duplicate_pay_period_items", duplicatePayPeriodItems);

const duplicatePayrollLines = groupDuplicates(
  payrollLineItems,
  (item) => `${item.payroll_run_id}|${item.profile_id}|${item.project_id ?? "no-project"}`,
);
if (duplicatePayrollLines.length > 0) fail("duplicate_payroll_line_items", duplicatePayrollLines);

const duplicateClosureRunWorker = groupDuplicates(
  payrollClosures,
  (item) => `${item.payroll_run_id}|${item.profile_id}`,
);
if (duplicateClosureRunWorker.length > 0) fail("duplicate_payroll_closures_run_worker", duplicateClosureRunWorker);

const duplicateClosureCutoff = groupDuplicates(
  payrollClosures,
  (item) => `${item.profile_id}|${item.closed_through}`,
);
if (duplicateClosureCutoff.length > 0) fail("duplicate_payroll_closures_cutoff", duplicateClosureCutoff);

const closuresByWorker = new Map();
for (const closure of payrollClosures) {
  const run = payrollRunsById.get(closure.payroll_run_id);
  if (!run) {
    fail("closure_without_run", closure);
    continue;
  }
  const start = dateMs(`${run.period_start}T00:00:00Z`);
  const end = dateMs(closure.closed_through);
  if (start === null || end === null) continue;
  const list = closuresByWorker.get(closure.profile_id) ?? [];
  list.push({ ...closure, start, end, runStart: run.period_start, runEnd: run.period_end });
  closuresByWorker.set(closure.profile_id, list);
}

for (const [workerId, closures] of closuresByWorker) {
  closures.sort((left, right) => left.start - right.start);
  for (let i = 0; i < closures.length; i += 1) {
    for (let j = i + 1; j < closures.length; j += 1) {
      const left = closures[i];
      const right = closures[j];
      if (right.start <= left.end && left.start <= right.end) {
        fail("overlapping_payroll_closures", {
          workerId,
          left: { id: left.id, runStart: left.runStart, closedThrough: left.closed_through },
          right: { id: right.id, runStart: right.runStart, closedThrough: right.closed_through },
        });
      }
    }
  }
}

for (const item of payPeriodItems) {
  if (item.status !== "paid") continue;
  const period = payPeriodsById.get(item.pay_period_id);
  if (!period) {
    fail("paid_item_without_period", item);
    continue;
  }
  const periodEndMs = dateMs(endOfDateIso(period.end_date));
  const hasClosure = (payrollClosures ?? []).some((closure) => {
    if (closure.profile_id !== item.worker_id) return false;
    const closedMs = dateMs(closure.closed_through);
    return closedMs !== null && periodEndMs !== null && closedMs >= periodEndMs;
  });
  const backedByLedger = payrollRuns.some((run) => {
    const metadata = run.metadata ?? {};
    return metadata.pay_period_id === item.pay_period_id;
  });
  if (!hasClosure && !backedByLedger) {
    fail("paid_item_without_closure_or_ledger", {
      itemId: item.id,
      payPeriodId: item.pay_period_id,
      workerId: item.worker_id,
    });
  }
}

for (const task of tasks) {
  const metadata = task.metadata ?? {};
  const referencedIds = [
    ...asArray(metadata.attachment_media_ids),
    ...asArray(metadata.completion_media_ids),
  ];
  for (const mediaId of referencedIds) {
    const row = mediaById.get(mediaId);
    if (!row) {
      fail("task_references_missing_media", { taskId: task.id, mediaId });
    } else if (row.deleted_at) {
      warn("task_references_deleted_media", { taskId: task.id, mediaId });
    }
  }
}

for (const project of projects) {
  if (project.status === "archived" && project.deleted_at) {
    fail("archived_project_in_trash", {
      projectId: project.id,
      name: project.name,
      deletedAt: project.deleted_at,
    });
  }
  if (project.status === "archived" && !project.archived_at) {
    warn("archived_project_missing_archived_at", { projectId: project.id, name: project.name });
  }
}

for (const row of media) {
  const metadata = row.metadata ?? {};
  const isReceipt = metadata.kind === "receipt" || metadata.category === "receipt";
  if (!isReceipt || row.deleted_at) continue;
  const amount = Number(metadata.amount ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) {
    warn("receipt_missing_amount", { mediaId: row.id, filename: row.filename });
  }
  if (!row.project_id) {
    warn("receipt_without_project", { mediaId: row.id, filename: row.filename });
  }
}

const importantAuditActions = new Set([
  "payroll_approved",
  "payroll_paid",
  "worker_hours_adjusted",
  "worker_hours_manual_close",
  "task_status_changed",
  "task_deleted",
  "receipt_uploaded",
  "receipt_deleted",
  "project_archived",
  "capability_changed",
]);
const presentAuditActions = new Set(auditRows.map((row) => row.action));
for (const action of importantAuditActions) {
  if (!presentAuditActions.has(action)) note("audit_action_not_seen_yet", { action });
}

const financeRpc = await supabase.rpc("has_finance_access");
if (financeRpc.error) {
  fail("has_finance_access_rpc_missing_or_failed", {
    message: financeRpc.error.message,
    code: financeRpc.error.code,
  });
} else {
  note("has_finance_access_rpc_ok", { resultForServiceRoleContext: financeRpc.data });
}

const duplicateCapabilities = groupDuplicates(
  userCapabilities,
  (item) => `${item.user_id}|${item.capability}`,
);
if (duplicateCapabilities.length > 0) fail("duplicate_user_capabilities", duplicateCapabilities);

const report = {
  checkedAt: new Date().toISOString(),
  counts: {
    payPeriods: payPeriods.length,
    payPeriodItems: payPeriodItems.length,
    payrollRuns: payrollRuns.length,
    payrollLineItems: payrollLineItems.length,
    payrollClosures: payrollClosures.length,
    tasks: tasks.length,
    media: media.length,
    projects: projects.length,
    auditRows: auditRows.length,
    userCapabilities: userCapabilities.length,
  },
  notes,
  warnings,
  failures,
};

console.log(JSON.stringify(report, null, 2));

if (failures.length > 0) {
  process.exit(1);
}
