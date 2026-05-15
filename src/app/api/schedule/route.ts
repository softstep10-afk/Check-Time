import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/types/database";

type ScheduleKind =
  | "client_meeting"
  | "worker_meeting"
  | "inspection"
  | "subcontractor_meeting"
  | "site_visit"
  | "meeting"
  | "task"
  | "note"
  | "delivery";

const CALENDAR_ROLES = new Set<UserRole>([
  "worker",
  "driver",
  "subcontractor",
  "supervisor",
  "sales",
  "manager",
  "admin",
  "owner",
]);
const DELIVERY_ONLY_ROLES = new Set<UserRole>(["worker", "driver", "subcontractor"]);
const DELIVERY_CLAIM_ROLES = new Set<UserRole>([
  "worker",
  "driver",
  "subcontractor",
  "supervisor",
  "sales",
  "manager",
  "admin",
  "owner",
]);

function isScheduleKind(value: unknown): value is ScheduleKind {
  return (
    value === "client_meeting" ||
    value === "worker_meeting" ||
    value === "inspection" ||
    value === "subcontractor_meeting" ||
    value === "site_visit" ||
    value === "meeting" ||
    value === "task" ||
    value === "note" ||
    value === "delivery"
  );
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function validDateOnly(value: string | null): string | null {
  if (!value) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : value;
}

function validDateTime(value: string | null): Date | null {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function localDateOnly(date: Date): string {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

async function getCalendarActor() {
  const supabase = await createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return { error: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const { data: profile, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single<Profile>();

  if (error || !profile) {
    return { error: NextResponse.json({ error: "Profile not found" }, { status: 404 }) };
  }

  if (!CALENDAR_ROLES.has(profile.role)) {
    return { error: NextResponse.json({ error: "Calendar access denied" }, { status: 403 }) };
  }

  return { profile };
}

export async function POST(request: Request) {
  const actor = await getCalendarActor();
  if ("error" in actor) return actor.error;

  const admin = createAdminClient();
  if (!admin) {
    return NextResponse.json(
      { error: "Server admin client is not configured for calendar writes." },
      { status: 500 },
    );
  }

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = stringOrNull(body?.action);

  if (action === "create_item") {
    const title = stringOrNull(body?.title);
    const rawKind = isScheduleKind(body?.kind) ? body.kind : "client_meeting";
    const kind: ScheduleKind = rawKind === "meeting" ? "client_meeting" : rawKind;
    const description = stringOrNull(body?.description);
    const projectId = stringOrNull(body?.projectId);
    const assignedTo = stringOrNull(body?.assignedTo);
    const startsAt = validDateTime(stringOrNull(body?.startsAt));
    const endsAt = validDateTime(stringOrNull(body?.endsAt));

    if (!title || !startsAt) {
      return NextResponse.json({ error: "Title and start time are required." }, { status: 400 });
    }

    if (DELIVERY_ONLY_ROLES.has(actor.profile.role) && kind !== "delivery") {
      return NextResponse.json({ error: "Workers can create delivery calendar items only." }, { status: 403 });
    }

    if (endsAt && endsAt.getTime() < startsAt.getTime()) {
      return NextResponse.json({ error: "End time must be after start time." }, { status: 400 });
    }

    if (projectId) {
      const { data: project, error } = await admin
        .from("projects")
        .select("id")
        .eq("id", projectId)
        .eq("org_id", actor.profile.org_id)
        .maybeSingle<{ id: string }>();

      if (error || !project) {
        return NextResponse.json({ error: "Project not found." }, { status: 404 });
      }
    }

    if (assignedTo) {
      const { data: assignee, error } = await admin
        .from("profiles")
        .select("id")
        .eq("id", assignedTo)
        .eq("org_id", actor.profile.org_id)
        .maybeSingle<{ id: string }>();

      if (error || !assignee) {
        return NextResponse.json({ error: "Assignee not found." }, { status: 404 });
      }
    }

    const { data, error } = await admin
      .from("tasks")
      .insert({
        org_id: actor.profile.org_id,
        project_id: projectId,
        assigned_to: assignedTo,
        assigned_by: actor.profile.id,
        title,
        description,
        priority: kind === "task" || kind === "delivery" ? "medium" : "low",
        status: "pending",
        due_date: localDateOnly(startsAt),
        metadata: {
          schedule_entry: true,
          schedule_kind: kind,
          schedule_scope: kind === "delivery" ? "delivery" : "general",
          schedule_visible_to_workers: kind === "delivery",
          schedule_delivery_status:
            kind === "delivery"
              ? assignedTo
                ? "assigned"
                : "open"
              : null,
          delivery_available_to: kind === "delivery" ? "team" : null,
          schedule_starts_at: startsAt.toISOString(),
          schedule_ends_at: endsAt ? endsAt.toISOString() : null,
          schedule_created_by_role: actor.profile.role,
        },
      })
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, item: data });
  }

  if (action === "update_project_dates") {
    if (DELIVERY_ONLY_ROLES.has(actor.profile.role)) {
      return NextResponse.json({ error: "Project date edits are not available from the delivery calendar." }, { status: 403 });
    }

    const projectId = stringOrNull(body?.projectId);
    const startDate = validDateOnly(stringOrNull(body?.startDate));
    const endDate = validDateOnly(stringOrNull(body?.endDate));

    if (!projectId) {
      return NextResponse.json({ error: "Project is required." }, { status: 400 });
    }

    if (body?.startDate && !startDate) {
      return NextResponse.json({ error: "Invalid start date." }, { status: 400 });
    }

    if (body?.endDate && !endDate) {
      return NextResponse.json({ error: "Invalid end date." }, { status: 400 });
    }

    if (startDate && endDate && startDate > endDate) {
      return NextResponse.json({ error: "End date must be after start date." }, { status: 400 });
    }

    const { data: project, error: lookupError } = await admin
      .from("projects")
      .select("id")
      .eq("id", projectId)
      .eq("org_id", actor.profile.org_id)
      .maybeSingle<{ id: string }>();

    if (lookupError || !project) {
      return NextResponse.json({ error: "Project not found." }, { status: 404 });
    }

    const { data, error } = await admin
      .from("projects")
      .update({
        start_date: startDate,
        end_date: endDate,
      })
      .eq("id", projectId)
      .eq("org_id", actor.profile.org_id)
      .select("*")
      .single();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, project: data });
  }

  if (action === "claim_delivery") {
    if (!DELIVERY_CLAIM_ROLES.has(actor.profile.role)) {
      return NextResponse.json({ error: "This role cannot claim deliveries." }, { status: 403 });
    }

    const taskId = stringOrNull(body?.taskId);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id, org_id, project_id, assigned_to, status, completed_at, deleted_at, metadata")
      .eq("id", taskId)
      .eq("org_id", actor.profile.org_id)
      .maybeSingle<{
        id: string;
        org_id: string;
        project_id: string | null;
        assigned_to: string | null;
        status: string;
        completed_at: string | null;
        deleted_at: string | null;
        metadata: Record<string, unknown> | null;
      }>();

    if (taskError || !task) {
      return NextResponse.json({ error: taskError?.message ?? "Delivery not found." }, { status: 404 });
    }
    const metadata = asRecord(task.metadata);
    if (metadata.schedule_kind !== "delivery") {
      return NextResponse.json({ error: "Task is not a delivery." }, { status: 400 });
    }
    if (task.deleted_at || task.status === "done" || task.completed_at) {
      return NextResponse.json({ error: "Delivery is already closed." }, { status: 409 });
    }
    if (task.assigned_to && task.assigned_to !== actor.profile.id) {
      return NextResponse.json({ error: "Delivery is already claimed." }, { status: 409 });
    }

    const claimedAt = new Date().toISOString();
    const nextMetadata = {
      ...metadata,
      schedule_delivery_status: "claimed",
      delivery_claimed_by: actor.profile.id,
      delivery_claimed_at: claimedAt,
      claimed_by: actor.profile.id,
      claimed_at: claimedAt,
    };

    const { data: updated, error } = await admin
      .from("tasks")
      .update({
        assigned_to: actor.profile.id,
        metadata: nextMetadata,
      })
      .eq("id", taskId)
      .eq("org_id", actor.profile.org_id)
      .is("deleted_at", null)
      .neq("status", "done")
      .is("completed_at", null)
      .or(`assigned_to.is.null,assigned_to.eq.${actor.profile.id}`)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    if (!updated) {
      return NextResponse.json({ error: "Delivery is already claimed or closed." }, { status: 409 });
    }

    return NextResponse.json({ ok: true, item: updated });
  }

  if (action === "complete_delivery") {
    const taskId = stringOrNull(body?.taskId);
    const note = stringOrNull(body?.note);
    if (!taskId) {
      return NextResponse.json({ error: "taskId is required." }, { status: 400 });
    }

    const { data: task, error: taskError } = await admin
      .from("tasks")
      .select("id, org_id, assigned_to, status, completed_at, deleted_at, metadata")
      .eq("id", taskId)
      .eq("org_id", actor.profile.org_id)
      .maybeSingle<{
        id: string;
        org_id: string;
        assigned_to: string | null;
        status: string;
        completed_at: string | null;
        deleted_at: string | null;
        metadata: Record<string, unknown> | null;
      }>();

    if (taskError || !task) {
      return NextResponse.json({ error: taskError?.message ?? "Delivery not found." }, { status: 404 });
    }
    const metadata = asRecord(task.metadata);
    if (metadata.schedule_kind !== "delivery") {
      return NextResponse.json({ error: "Task is not a delivery." }, { status: 400 });
    }
    if (task.deleted_at) {
      return NextResponse.json({ error: "Delivery has been deleted." }, { status: 410 });
    }
    if (task.status === "done" || task.completed_at) {
      return NextResponse.json({ ok: true, item: task });
    }
    if (task.assigned_to && task.assigned_to !== actor.profile.id && !["owner", "admin", "manager", "supervisor"].includes(actor.profile.role)) {
      return NextResponse.json({ error: "Delivery belongs to another team member." }, { status: 403 });
    }

    const completedAt = new Date().toISOString();
    const completedBy = task.assigned_to ?? actor.profile.id;
    const nextMetadata = {
      ...metadata,
      schedule_delivery_status: "delivered",
      delivered_by: completedBy,
      delivered_at: completedAt,
      delivery_completed_by: completedBy,
      delivery_completed_at: completedAt,
      ...(note ? { completion_note: note } : {}),
    };

    const { data: updated, error } = await admin
      .from("tasks")
      .update({
        assigned_to: completedBy,
        status: "done",
        completed_at: completedAt,
        completed_by: completedBy,
        metadata: nextMetadata,
      })
      .eq("id", taskId)
      .eq("org_id", actor.profile.org_id)
      .is("deleted_at", null)
      .select("*")
      .maybeSingle();

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, item: updated });
  }

  return NextResponse.json({ error: "Unknown calendar action." }, { status: 400 });
}
