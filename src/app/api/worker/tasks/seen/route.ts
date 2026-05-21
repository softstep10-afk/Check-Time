import { NextRequest, NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function readTaskIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item): item is string => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  ).slice(0, 100);
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();

    if (authError || !user) {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("id, org_id")
      .eq("id", user.id)
      .maybeSingle<{ id: string; org_id: string }>();

    if (profileError || !profile) {
      return NextResponse.json(
        { error: profileError?.message ?? "Profile not found." },
        { status: 403 },
      );
    }

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const taskIds = readTaskIds(body.taskIds);
    if (taskIds.length === 0) {
      return NextResponse.json({ ok: true, updated: 0 });
    }

    const { data: visibleTasks, error: visibleError } = await supabase
      .from("tasks")
      .select("id, org_id, metadata")
      .eq("org_id", profile.org_id)
      .in("id", taskIds)
      .is("deleted_at", null);

    if (visibleError) {
      return NextResponse.json({ error: visibleError.message }, { status: 500 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Server admin client is not configured." },
        { status: 500 },
      );
    }

    const seenAt = new Date().toISOString();
    let updated = 0;
    const linkedMessageIds = new Set<string>();

    for (const task of (visibleTasks ?? []) as Array<{
      id: string;
      org_id: string;
      metadata: Record<string, unknown> | null;
    }>) {
      const metadata = asRecord(task.metadata);
      if (typeof metadata.message_id === "string" && metadata.message_id.trim()) {
        linkedMessageIds.add(metadata.message_id.trim());
      }
      const seenBy = asRecord(metadata.seen_by);
      const nextMetadata = {
        ...metadata,
        seen_by: {
          ...seenBy,
          [profile.id]: seenAt,
        },
        last_seen_by: profile.id,
        last_seen_at: seenAt,
      };

      const { error: updateError } = await admin
        .from("tasks")
        .update({ metadata: nextMetadata })
        .eq("id", task.id)
        .eq("org_id", profile.org_id);

      if (!updateError) {
        updated += 1;
      }
    }

    let messagesMarkedRead = 0;
    if (linkedMessageIds.size > 0) {
      const { data: linkedMessages, error: messageUpdateError } = await admin
        .from("messages")
        .update({ read: true })
        .eq("org_id", profile.org_id)
        .eq("recipient_id", profile.id)
        .in("id", [...linkedMessageIds])
        .select("id");

      if (!messageUpdateError) {
        messagesMarkedRead = linkedMessages?.length ?? 0;
      }
    }

    if (updated > 0) {
      revalidatePath("/command-center");
      revalidatePath("/overview");
      revalidatePath("/tasks");
      revalidatePath("/my-tasks");
      revalidatePath("/projects");
    }

    return NextResponse.json({ ok: true, updated, messagesMarkedRead, seenAt });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
