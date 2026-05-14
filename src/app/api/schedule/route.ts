import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { Profile, UserRole } from "@/types/database";

type ScheduleKind = "meeting" | "task" | "note";

const CALENDAR_ROLES = new Set<UserRole>([
  "owner",
  "admin",
  "manager",
  "supervisor",
  "sales",
]);

function isScheduleKind(value: unknown): value is ScheduleKind {
  return value === "meeting" || value === "task" || value === "note";
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
    const kind = isScheduleKind(body?.kind) ? body.kind : "meeting";
    const description = stringOrNull(body?.description);
    const projectId = stringOrNull(body?.projectId);
    const assignedTo = stringOrNull(body?.assignedTo);
    const startsAt = validDateTime(stringOrNull(body?.startsAt));
    const endsAt = validDateTime(stringOrNull(body?.endsAt));

    if (!title || !startsAt) {
      return NextResponse.json({ error: "Title and start time are required." }, { status: 400 });
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
        priority: kind === "task" ? "medium" : "low",
        status: "pending",
        due_date: localDateOnly(startsAt),
        metadata: {
          schedule_entry: true,
          schedule_kind: kind,
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

  return NextResponse.json({ error: "Unknown calendar action." }, { status: 400 });
}
