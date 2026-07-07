import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

// Persist the authenticated user's OWN UI locale to profiles.language so
// server-side features (push titles, Jarvis voice, future emails) match what
// the worker actually sees. Same auth boundary as the other worker routes:
// the server derives the profile id from the session and never trusts a
// client-supplied id. The locale is validated server-side; only the language
// column is written.

function parseLocale(value: unknown): "en" | "ru" | null {
  return value === "en" || value === "ru" ? value : null;
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

    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const locale = parseLocale(body.locale);
    if (!locale) {
      return NextResponse.json({ error: "Unsupported locale." }, { status: 400 });
    }

    const admin = createAdminClient();
    if (!admin) {
      return NextResponse.json(
        { error: "Language update is temporarily unavailable." },
        { status: 503 },
      );
    }

    // Server-derived identity — the client never supplies the profile id.
    const { error: updateError } = await admin
      .from("profiles")
      .update({ language: locale })
      .eq("id", user.id);

    if (updateError) {
      return NextResponse.json({ error: updateError.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, language: locale });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
