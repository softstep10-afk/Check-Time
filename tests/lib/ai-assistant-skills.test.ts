import { describe, expect, it } from "vitest";
import { answerManagerAssistant, buildAssistantSnapshot } from "@/lib/ai/service";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type { Media, Profile, Project, Task } from "@/types/database";

function profile(overrides: Partial<Profile>): Profile {
  return {
    id: "profile",
    org_id: "org",
    name: "Profile",
    role: "worker",
    pin_hash: null,
    color: "#2dd4bf",
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

function project(overrides: Partial<Project>): Project {
  return {
    id: "project",
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
    settings: {},
    timeline_status: null,
    budget_status: null,
    deleted_at: null,
    created_at: "2026-05-01T00:00:00.000Z",
    updated_at: "2026-05-01T00:00:00.000Z",
    ...overrides,
  };
}

function task(overrides: Partial<Task>): Task {
  return {
    id: "task",
    org_id: "org",
    project_id: "project",
    assigned_to: null,
    assigned_by: "owner",
    title: "Frame new wall",
    description: "Need framing before drywall.",
    priority: "high",
    status: "pending",
    due_date: null,
    completed_at: null,
    completed_by: null,
    metadata: {},
    deleted_at: null,
    created_at: "2026-05-10T00:00:00.000Z",
    updated_at: "2026-05-10T00:00:00.000Z",
    ...overrides,
  };
}

function media(overrides: Partial<Media>): Media {
  return {
    id: "media",
    org_id: "org",
    project_id: "project",
    uploaded_by: "vasia",
    media_type: "photo",
    storage_path: "project/glass-delivery.jpg",
    filename: "glass-delivery.jpg",
    file_size: 1000,
    mime_type: "image/jpeg",
    caption: "Glass delivery staged near the front door.",
    is_checkout: false,
    time_event_id: null,
    ai_analysis: {
      summary: "Delivery staging photo with glass material visible.",
      progressObservation: "Materials are staged for installation.",
      safetyFlags: [],
      qualityFlags: [],
      followUps: [],
      tags: ["delivery", "glass", "staging"],
      confidence: 0.8,
      source: "fallback",
    },
    metadata: {},
    deleted_at: null,
    created_at: "2026-05-12T00:00:00.000Z",
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

function workspace(): ManagerWorkspaceData {
  const owner = profile({ id: "owner", name: "Andrew", role: "owner" });
  const vasia = profile({
    id: "vasia",
    name: "Vasia",
    role: "worker",
    settings: {
      worker_skills: ["framing", "mudding"],
      worker_capabilities_note: "Strong on framing and patching.",
    },
  });
  const dima = profile({
    id: "dima",
    name: "Dima",
    role: "worker",
    settings: { worker_skills: ["delivery"] },
  });

  return {
    manager: owner,
    org: {
      id: "org",
      name: "NW Build",
      slug: "nw",
      settings: {},
      created_at: "2026-05-01T00:00:00.000Z",
      updated_at: "2026-05-01T00:00:00.000Z",
    },
    profiles: [owner, vasia, dima],
    projects: [project({ id: "project", name: "Home" })],
    assignments: [],
    tasks: [task({ id: "task", project_id: "project" })],
    timeEvents: [],
    media: [],
    payrollRuns: [],
    payrollClosures: [],
    storeVisits: [],
  };
}

describe("AI assistant worker skill suggestions", () => {
  it("includes worker skills in the snapshot and recommends a matching worker", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      expect(snapshot.assignmentSuggestions[0]?.candidates[0]?.name).toBe("Vasia");
      expect(snapshot.projects[0]?.skillTags).toContain("framing");

      const answer = await answerManagerAssistant(
        "Кого поставить на фрейм на Home?",
        snapshot,
      );

      expect(answer.answer).toContain("Vasia");
      expect(answer.bullets.join(" ")).toContain("фрейм");
    });
  });

  it("searches recent media by description", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.media = [media({ id: "media-glass" })];
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("найди фото glass delivery", snapshot);

      expect(answer.answer).toContain("нашёл");
      expect(answer.bullets.join(" ")).toContain("glass-delivery.jpg");
    });
  });

  it("gives rough estimates from task skills", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.org.settings = {
        jarvis_memory: [
          {
            id: "rule-1",
            text: "For Home framing, Vasia must send a progress photo before payroll closes.",
            createdAt: "2026-05-14T00:00:00.000Z",
            createdBy: "owner",
            source: "manual",
          },
        ],
      };
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("Сделай эстимейт на фрейм Home", snapshot);

      expect(answer.answer).toContain("человеко-часов");
      expect(answer.bullets.join(" ")).toContain("каркас");
      expect(answer.bullets.join(" ")).toContain("progress photo");
    });
  });

  it("answers Washington code questions with official reference links", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("Что по коду Вашингтона для safety inspection?", snapshot);

      expect(answer.answer).toContain("AHJ");
      expect(answer.links.some((link) => link.href.startsWith("https://"))).toBe(true);
    });
  });

  it("matches overview material totals and ignores legacy receipt-like rows", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.media = [
        media({
          id: "receipt-good",
          filename: "home-depot.jpg",
          metadata: {
            category: "receipt",
            amount: 9976,
            store_name: "Home Depot",
            purchase_date: "2026-05-13",
          },
        }),
        media({
          id: "receipt-legacy-kind-only",
          filename: "bad-old-row.jpg",
          metadata: {
            kind: "receipt",
            amount: 532544,
          },
        }),
        media({
          id: "receipt-unlinked",
          project_id: null,
          filename: "unlinked.jpg",
          metadata: {
            category: "receipt",
            amount: 1000,
          },
        }),
      ];
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      expect(snapshot.receiptTotal).toBe(9976);
      expect(snapshot.projects[0]?.receiptTotal).toBe(9976);

      const answer = await answerManagerAssistant(
        "сколько сейчас потрачено денег на материал?",
        snapshot,
      );

      expect(answer.answer).toContain("$9,976.00");
      expect(answer.answer).not.toContain("532");
      expect(answer.bullets.join(" ")).toContain("карточка");
    });
  });

  it("treats a greeting as conversation even when a file is attached", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("привет", snapshot, {
        attachments: [
          {
            filename: "plan.pdf",
            mimeType: "application/pdf",
            content: "floor plan notes",
            dataUrl: null,
          },
        ],
      });

      expect(answer.answer).toBe("Сэр?");
      expect(answer.answer).not.toContain("файл");
      expect(answer.bullets).toEqual([]);
    });
  });
});
