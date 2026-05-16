import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json(
    { error: "Legacy realtime connection endpoint removed. Use /api/ai/voice." },
    { status: 410 },
  );
}
