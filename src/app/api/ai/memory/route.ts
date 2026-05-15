import { NextRequest, NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import {
  appendJarvisMemoryRule,
  isJarvisMemoryWriter,
  readJarvisMemory,
  removeJarvisMemoryRule,
} from "@/lib/ai/jarvis-memory";
import { createClient } from "@/lib/supabase/server";

function assertNoError(error: { message: string } | null, label: string) {
  if (error) {
    throw new Error(`${label}: ${error.message}`);
  }
}

export async function GET() {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const org = auth.kind === "preview" ? auth.managerData.org : auth.context.org;
    const profile = auth.kind === "preview" ? auth.managerData.manager : auth.context.profile;

    return NextResponse.json({
      ok: true,
      memory: readJarvisMemory(org.settings),
      canWrite: auth.kind === "authenticated" && isJarvisMemoryWriter(profile),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (auth.kind !== "authenticated" || !isJarvisMemoryWriter(auth.context.profile)) {
      return NextResponse.json({ error: "Only owner/admin can teach Jarvis." }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const text = typeof body.text === "string" ? body.text.trim() : "";
    if (text.length < 6) {
      return NextResponse.json({ error: "Rule text is too short." }, { status: 400 });
    }

    const updated = appendJarvisMemoryRule({
      org: auth.context.org,
      text,
      createdBy: auth.context.profile.id,
      source: "manual",
    });
    const { error } = await supabase
      .from("organizations")
      .update({ settings: updated.settings })
      .eq("id", auth.context.org.id);
    assertNoError(error, "Jarvis memory update failed");

    return NextResponse.json({
      ok: true,
      rule: updated.rule,
      memory: updated.memory,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind === "unauthenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }
    if (auth.kind !== "authenticated" || !isJarvisMemoryWriter(auth.context.profile)) {
      return NextResponse.json({ error: "Only owner/admin can edit Jarvis memory." }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : "";
    if (!id) {
      return NextResponse.json({ error: "Memory id is required." }, { status: 400 });
    }

    const updated = removeJarvisMemoryRule(auth.context.org.settings, id);
    const { error } = await supabase
      .from("organizations")
      .update({ settings: updated.settings })
      .eq("id", auth.context.org.id);
    assertNoError(error, "Jarvis memory delete failed");

    return NextResponse.json({
      ok: true,
      memory: updated.memory,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
