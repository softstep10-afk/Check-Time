import { describe, expect, it } from "vitest";
import { answerWorkerAssistant } from "@/lib/ai/service";
import { PROJECT_MATERIAL_SPEC_KEY } from "@/lib/project-planning";
import type { WorkerShellData } from "@/lib/worker-types";
import type { Profile } from "@/types/database";

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "worker",
    org_id: "org",
    name: "Vasia",
    role: "worker",
    pin_hash: null,
    color: "#38bdf8",
    is_active: true,
    require_video: false,
    hourly_rate: 35,
    language: "ru",
    settings: {},
    last_clock_in: null,
    current_project: null,
    project_access_mode: "list",
    notif_mode: "sound",
    deleted_at: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

async function withModelDisabled<T>(fn: () => Promise<T>): Promise<T> {
  const oldGoogleKey = process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  const oldGeminiKey = process.env.GEMINI_API_KEY;
  const oldGoogleAiKey = process.env.GOOGLE_AI_API_KEY;
  const oldGeminiModel = process.env.GEMINI_MODEL;
  delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  delete process.env.GOOGLE_AI_API_KEY;
  delete process.env.GEMINI_MODEL;

  try {
    return await fn();
  } finally {
    if (oldGoogleKey === undefined) delete process.env.GOOGLE_GENERATIVE_AI_API_KEY;
    else process.env.GOOGLE_GENERATIVE_AI_API_KEY = oldGoogleKey;
    if (oldGeminiKey === undefined) delete process.env.GEMINI_API_KEY;
    else process.env.GEMINI_API_KEY = oldGeminiKey;
    if (oldGoogleAiKey === undefined) delete process.env.GOOGLE_AI_API_KEY;
    else process.env.GOOGLE_AI_API_KEY = oldGoogleAiKey;
    if (oldGeminiModel === undefined) delete process.env.GEMINI_MODEL;
    else process.env.GEMINI_MODEL = oldGeminiModel;
  }
}

function workerShell(): WorkerShellData {
  return {
    profile: profile({ id: "vasia", name: "Vasia" }),
    projects: [
      {
        id: "home",
        org_id: "org",
        name: "Home",
        address: "Auburn, WA",
        notes: null,
        status: "active",
        rate: 0,
        site_point: null,
        radius_m: 100,
        start_date: null,
        end_date: null,
        settings: {
          [PROJECT_MATERIAL_SPEC_KEY]: [
            {
              id: "mat-1",
              name: "Drywall 5/8",
              quantity: "40",
              unit: "sheets",
              supplier: "Home Depot",
              link: "https://example.com",
              note: "Type X",
              category: "",
              createdAt: "2026-05-14T00:00:00.000Z",
              updatedAt: "2026-05-14T00:00:00.000Z",
            },
          ],
        },
        timeline_status: null,
        budget_status: null,
        deleted_at: null,
        created_at: "2026-05-01T00:00:00.000Z",
        updated_at: "2026-05-01T00:00:00.000Z",
        assignedAt: "2026-05-01T00:00:00.000Z",
        site: null,
      },
    ],
    tasks: [],
    media: [],
    sessions: [],
    clockState: {
      isClockedIn: true,
      clockInTime: "2026-05-14T16:00:00.000Z",
      currentProjectId: "home",
      currentProjectName: "Home",
      openEventId: "event-1",
      pendingCheckoutEventId: null,
      pendingCheckoutProjectId: null,
      pendingCheckoutProjectName: null,
      pendingStartVideoEventId: null,
      pendingStartVideoProjectId: null,
      pendingStartVideoProjectName: null,
    },
    summary: { todayMinutes: 30, weekMinutes: 120, totalSessions: 2 },
    adjustments: [],
    closures: [],
  };
}

describe("worker Jarvis", () => {
  it("answers from worker-visible materials without exposing finance", async () => {
    await withModelDisabled(async () => {
      const answer = await answerWorkerAssistant("какие материалы на Home?", workerShell());
      const text = `${answer.answer} ${answer.bullets.join(" ")}`.toLowerCase();

      expect(text).toContain("drywall");
      expect(text).not.toContain("payroll");
      expect(text).not.toContain("rate");
      expect(text).not.toContain("ставк");
    });
  });
});
