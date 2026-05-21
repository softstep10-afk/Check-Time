import { describe, expect, it } from "vitest";
import {
  answerManagerAssistant,
  buildAssistantSnapshot,
  buildJarvisWakeResponse,
} from "@/lib/ai/service";
import { getActiveOperationalProjects } from "@/lib/archive-utils";
import {
  buildManagerSessions,
  buildProfileSummaries,
  buildProjectSummaries,
  getOverviewStats,
} from "@/lib/manager-utils";
import type { ManagerWorkspaceData } from "@/lib/manager-types";
import type { Media, Profile, Project, Task, TimeEvent } from "@/types/database";

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

function timeEvent(overrides: Partial<TimeEvent> & Pick<TimeEvent, "id" | "profile_id" | "project_id" | "event_type" | "event_time">): TimeEvent {
  const eventTime = overrides.event_time;
  return {
    ...overrides,
    id: overrides.id,
    org_id: "org",
    profile_id: overrides.profile_id,
    project_id: overrides.project_id,
    event_type: overrides.event_type,
    event_time: eventTime,
    server_time: eventTime,
    gps_point: null,
    gps_accuracy_m: null,
    gps_source: null,
    adjusts_event_id: null,
    adjust_reason: null,
    adjusted_by: null,
    video_status: "not_required",
    video_storage_path: null,
    notes: null,
    metadata: {},
    created_at: eventTime,
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

describe("AI assistant Jarvis routing", () => {
  it("keeps worker skills in the snapshot without local recommendation fallback", async () => {
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

      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.bullets).toEqual([]);
    });
  });

  it("keeps recent media in the snapshot without local media-search fallback", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.media = [media({ id: "media-glass" })];
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("найди фото glass delivery", snapshot);

      expect(snapshot.mediaIndex[0]?.filename).toBe("glass-delivery.jpg");
      expect(answer.answer).toContain("Jarvis временно недоступен");
    });
  });

  it("does not generate local rough estimates when Jarvis model is unavailable", async () => {
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

      expect(snapshot.memoryRules).toEqual([]);
      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.answer).not.toContain("человеко-часов");
    });
  });

  it("keeps worked-hour shift data in the snapshot without local estimate fallback", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.timeEvents = [
        timeEvent({
          id: "in",
          profile_id: "vasia",
          project_id: "project",
          event_type: "clock_in",
          event_time: "2026-05-15T09:00:00.000Z",
        }),
        timeEvent({
          id: "out",
          profile_id: "vasia",
          project_id: "project",
          event_type: "clock_out",
          event_time: "2026-05-15T17:30:00.000Z",
        }),
      ];
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("сколько часов отработал Vasia последняя смена?", snapshot);

      expect(snapshot.recentShifts[0]?.workerName).toBe("Vasia");
      expect(snapshot.recentShifts[0]?.durationMinutes).toBe(510);
      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.answer.toLowerCase()).not.toContain("эстимейт");
      expect(answer.answer).not.toContain("человеко-часов");
    });
  });

  it("does not answer current-worker questions with monthly rankings", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.timeEvents = [
        timeEvent({
          id: "in",
          profile_id: "vasia",
          project_id: "project",
          event_type: "clock_in",
          event_time: "2026-05-15T09:00:00.000Z",
        }),
      ];
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("кто сейчас на работе?", snapshot);

      expect(snapshot.liveWorkers[0]?.name).toBe("Vasia");
      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.answer.toLowerCase()).not.toContain("рейтинг");
      expect(answer.answer.toLowerCase()).not.toContain("месяц");
    });
  });

  it("keeps Washington code references in the snapshot without local code fallback", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant("Что по коду Вашингтона для safety inspection?", snapshot);

      expect(snapshot.codeReferences.some((reference) => reference.url.startsWith("https://"))).toBe(true);
      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.links).toEqual([]);
    });
  });

  it("matches overview material totals and ignores archived project receipts", async () => {
    await withModelDisabled(async () => {
      const data = workspace();
      data.projects = [
        project({ id: "project", name: "Home", status: "active" }),
        project({
          id: "archived-project",
          name: "Old Home",
          status: "archived",
          archived_at: "2026-05-14T00:00:00.000Z",
        }),
      ];
      data.media = [
        media({
          id: "receipt-good",
          project_id: "project",
          filename: "home-depot.jpg",
          metadata: {
            category: "receipt",
            amount: 9976,
            store_name: "Home Depot",
            purchase_date: "2026-05-13",
          },
        }),
        media({
          id: "receipt-archived",
          project_id: "archived-project",
          filename: "archived-large-row.jpg",
          metadata: {
            category: "receipt",
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
      const sessions = buildManagerSessions(data);
      const overviewProjectSummaries = getActiveOperationalProjects(
        buildProjectSummaries(data, sessions, {
          includeFinancials: true,
        }),
      );
      const overviewStats = getOverviewStats(
        data,
        sessions,
        overviewProjectSummaries,
        buildProfileSummaries(data, sessions),
        { includeFinancials: true },
      );
      const snapshot = buildAssistantSnapshot(data, [], {
        includeFinancials: true,
      });

      expect(overviewStats.receiptTotal).toBe(9976);
      expect(snapshot.receiptTotal).toBe(overviewStats.receiptTotal);
      expect(snapshot.receiptTotal).not.toBe(542520);
      expect(snapshot.projects[0]?.receiptTotal).toBe(9976);
      expect(snapshot.projects.map((item) => item.name)).toEqual(["Home"]);

      const answer = await answerManagerAssistant(
        "сколько сейчас потрачено денег на материал?",
        snapshot,
      );

      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.answer).not.toContain("532");
      expect(answer.bullets).toEqual([]);
    });
  });

  it("treats a greeting as conversation even when a file is attached", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      const wakeAnswer = buildJarvisWakeResponse("привет");
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

      expect(wakeAnswer?.answer).toBe("Слушаю");
      expect(answer.answer).toContain("Jarvis временно недоступен");
      expect(answer.answer).not.toContain("файл");
      expect(answer.bullets).toEqual([]);
    });
  });

  it("prepares a real task action without claiming it was created", async () => {
    await withModelDisabled(async () => {
      const snapshot = buildAssistantSnapshot(workspace(), [], {
        includeFinancials: true,
      });

      const answer = await answerManagerAssistant(
        "создай задачу для Vasia проверить плитку на Home",
        snapshot,
      );

      expect(answer.answer).toContain("Подготовил задачу");
      expect(answer.answer).not.toContain("Задача создана");
      expect(answer.actions?.[0]).toMatchObject({
        kind: "create_task",
        payload: {
          title: "проверить плитку",
          assignedTo: "vasia",
          assignedToName: "Vasia",
          projectId: "project",
          projectName: "Home",
        },
      });
    });
  });
});
