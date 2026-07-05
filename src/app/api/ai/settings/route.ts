import { NextRequest, NextResponse } from "next/server";
import { resolveAiApiContext } from "@/lib/ai/api-auth";
import {
  buildJarvisRuntimeSettings,
  resolveJarvisRuntimeConfig,
} from "@/lib/ai/jarvis-config";
import { safeClientErrorMessage } from "@/lib/safe-log";
import { createClient } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  try {
    const supabase = await createClient();
    const auth = await resolveAiApiContext(supabase);
    if (auth.kind !== "authenticated") {
      return NextResponse.json({ error: "Not authenticated." }, { status: 401 });
    }

    const { profile, org } = auth.context;
    if (profile.role !== "owner" && profile.role !== "admin") {
      return NextResponse.json({ error: "Only owner/admin can update Jarvis settings." }, { status: 403 });
    }

    const body = (await request.json()) as Record<string, unknown>;
    const settings = buildJarvisRuntimeSettings(org.settings, {
      systemPrompt: body.systemPrompt,
      voicePersonality: body.voicePersonality,
      reset: body.mode === "reset",
    });

    const { error } = await supabase
      .from("organizations")
      .update({ settings })
      .eq("id", org.id);

    if (error) {
      return NextResponse.json(
        { error: "Jarvis settings could not be saved." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      config: resolveJarvisRuntimeConfig(settings),
    });
  } catch (error) {
    return NextResponse.json(
      { error: safeClientErrorMessage(error, "Jarvis settings could not be saved.") },
      { status: 400 },
    );
  }
}
