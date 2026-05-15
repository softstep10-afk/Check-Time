import { describe, expect, it } from "vitest";
import {
  inferSkillTagsFromText,
  mergeProfileSkillSettings,
  parseSkillInput,
  readProfileSkillSettings,
  scoreWorkerForSkills,
} from "@/lib/profile-skills";

describe("profile skills", () => {
  it("recognizes Russian and English construction skill wording", () => {
    expect(inferSkillTagsFromText("Вася умеет круто шпаклевать и делать фрейм")).toEqual([
      "framing",
      "mudding",
    ]);
    expect(parseSkillInput("drywall, paint; delivery")).toEqual([
      "drywall",
      "paint",
      "delivery",
      "painting",
    ]);
  });

  it("stores skills in profile settings without dropping unrelated settings", () => {
    const next = mergeProfileSkillSettings(
      { notif: "sound" },
      "фрейм, drywall",
      "Лучше ставить на каркас и гипсокартон.",
    );

    expect(next.notif).toBe("sound");
    expect(next.worker_skills).toEqual(["фрейм", "drywall", "framing"]);
    expect(next.worker_capabilities_note).toContain("каркас");
  });

  it("scores a worker by matching recorded skills", () => {
    const worker = {
      id: "w1",
      name: "Vasia",
      role: "worker" as const,
      settings: {
        worker_skills: ["framing", "mudding"],
        worker_capabilities_note: "Fast on frame and patching.",
      },
    };

    expect(readProfileSkillSettings(worker.settings).skills).toEqual([
      "framing",
      "mudding",
    ]);
    expect(scoreWorkerForSkills(worker, ["framing"]).score).toBeGreaterThan(1);
  });
});
