import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isManagerRole } from "@/lib/manager-utils";
import { dispatchNotification } from "@/lib/notifications/dispatch";
import type { UserRole } from "@/types/database";

// Server-side message send (Push Phase 2). Manager-side actors used to insert
// into "messages" straight from the browser, which can't dispatch a push. This
// route is the single authenticated write path: it verifies the sender is a
// manager-tier actor, stamps org_id/sender_id from the *server* profile (a
// tampered client can't forge them), verifies every recipient is in the sender's
// org, inserts the same rows/fields as before, and fires a fire-and-forget push
// to each recipient. Message behavior is unchanged — same rows, same fields.

type IncomingRow = {
  recipient_id?: unknown;
  text?: unknown;
  color?: unknown;
  attachment?: unknown;
  metadata?: unknown;
  priority?: unknown;
};

type SenderProfile = { id: string; org_id: string; role: UserRole; name: string | null };

const CHUNK = 50;
const PREVIEW_LEN = 120;

function truncate(text: string): string {
  return text.length > PREVIEW_LEN ? `${text.slice(0, PREVIEW_LEN - 1)}…` : text;
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

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json({ error: "Messaging is temporarily unavailable." }, { status: 503 });
    }

    const { data: sender, error: senderError } = await admin
      .from("profiles")
      .select("id, org_id, role, name")
      .eq("id", user.id)
      .maybeSingle<SenderProfile>();
    if (senderError || !sender) {
      return NextResponse.json({ error: "Sender profile not found." }, { status: 403 });
    }
    if (!isManagerRole(sender.role)) {
      return NextResponse.json({ error: "Not authorized to send messages." }, { status: 403 });
    }

    const body = (await request.json().catch(() => ({}))) as { rows?: unknown };
    const incoming = Array.isArray(body.rows) ? (body.rows as IncomingRow[]) : [];
    if (incoming.length === 0) {
      return NextResponse.json({ error: "No messages to send." }, { status: 400 });
    }

    // Normalise + server-stamp org_id/sender_id (never trust the client for these).
    const rows = incoming
      .filter((row) => typeof row.recipient_id === "string" && typeof row.text === "string")
      .map((row) => ({
        org_id: sender.org_id,
        sender_id: sender.id,
        recipient_id: row.recipient_id as string,
        text: row.text as string,
        color: typeof row.color === "string" ? row.color : null,
        attachment: row.attachment ?? null,
        metadata: (row.metadata && typeof row.metadata === "object" ? row.metadata : {}) as Record<string, unknown>,
        priority: typeof row.priority === "string" ? row.priority : "info",
      }));
    if (rows.length === 0) {
      return NextResponse.json({ error: "No valid messages to send." }, { status: 400 });
    }

    // Recipients must be profiles in the sender's org.
    const recipientIds = [...new Set(rows.map((row) => row.recipient_id))];
    const { data: validRows, error: recipientError } = await admin
      .from("profiles")
      .select("id")
      .eq("org_id", sender.org_id)
      .in("id", recipientIds);
    if (recipientError) {
      return NextResponse.json({ error: recipientError.message }, { status: 500 });
    }
    const validRecipients = new Set((validRows ?? []).map((r) => (r as { id: string }).id));
    if (recipientIds.some((id) => !validRecipients.has(id))) {
      return NextResponse.json({ error: "A recipient is not in your organization." }, { status: 403 });
    }

    // Insert (chunked), with the same priority-column fallback the clients had.
    const inserted: Array<{ id: string; recipient_id: string }> = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);
      let result = await admin.from("messages").insert(chunk).select("id, recipient_id");
      if (result.error && /column .* priority/i.test(result.error.message)) {
        const fallback = chunk.map((row) => ({
          org_id: row.org_id,
          sender_id: row.sender_id,
          recipient_id: row.recipient_id,
          text: row.text,
          color: row.color,
          attachment: row.attachment,
          metadata: row.metadata,
        }));
        result = await admin.from("messages").insert(fallback).select("id, recipient_id");
      }
      if (result.error) {
        return NextResponse.json({ error: result.error.message }, { status: 500 });
      }
      inserted.push(...((result.data ?? []) as Array<{ id: string; recipient_id: string }>));
    }

    // Fire-and-forget push per DISTINCT recipient — never the sender.
    const title = sender.name?.trim() || "Check-Time";
    const previewByRecipient = new Map<string, string>();
    for (const row of rows) {
      if (row.recipient_id === sender.id) continue;
      if (!previewByRecipient.has(row.recipient_id)) {
        previewByRecipient.set(row.recipient_id, truncate(row.text.trim()));
      }
    }
    for (const [recipientId, preview] of previewByRecipient) {
      dispatchNotification(recipientId, {
        title,
        body: preview,
        url: "/my-messages",
        tag: `msg:${recipientId}`,
      });
    }

    return NextResponse.json({ ok: true, messages: inserted });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
