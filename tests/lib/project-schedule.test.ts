import { describe, expect, it } from "vitest";
import {
  countdownParts,
  deriveProjectScheduleHealth,
  formatProjectCountdown,
} from "@/lib/project-schedule";

describe("project schedule health", () => {
  const project = { startDate: "2026-05-01", endDate: "2026-05-31" };

  it("is green before half of the project span has elapsed", () => {
    const health = deriveProjectScheduleHealth(project, new Date(2026, 4, 10, 12));
    expect(health.state).toBe("on_track");
    expect(health.tone).toBe("green");
    expect(Math.round(health.elapsedPercent ?? 0)).toBeLessThan(50);
  });

  it("turns yellow once at least half of the span has elapsed", () => {
    const health = deriveProjectScheduleHealth(project, new Date(2026, 4, 18, 12));
    expect(health.state).toBe("half_elapsed");
    expect(health.tone).toBe("yellow");
    expect(Math.round(health.elapsedPercent ?? 0)).toBeGreaterThanOrEqual(50);
  });

  it("turns red when ten percent or less remains", () => {
    const health = deriveProjectScheduleHealth(project, new Date(2026, 4, 29, 12));
    expect(health.state).toBe("almost_due");
    expect(health.tone).toBe("red");
    expect(health.remainingPercent ?? 100).toBeLessThanOrEqual(10);
  });

  it("stays red after the deadline passes", () => {
    const health = deriveProjectScheduleHealth(project, new Date(2026, 5, 2, 9));
    expect(health.state).toBe("overdue");
    expect(health.tone).toBe("red");
    expect(health.overdueMs).toBeGreaterThan(0);
  });

  it("handles future starts as green with zero elapsed progress", () => {
    const health = deriveProjectScheduleHealth(project, new Date(2026, 3, 25, 9));
    expect(health.state).toBe("not_started");
    expect(health.tone).toBe("green");
    expect(health.elapsedPercent).toBe(0);
  });

  it("keeps unscheduled projects neutral", () => {
    const health = deriveProjectScheduleHealth({ startDate: null, endDate: null });
    expect(health.state).toBe("unscheduled");
    expect(health.tone).toBe("neutral");
  });

  it("formats countdown as days and hours", () => {
    expect(countdownParts(25 * 60 * 60 * 1000)).toEqual({ days: 1, hours: 1 });
    expect(formatProjectCountdown({ remainingMs: 25 * 60 * 60 * 1000, overdueMs: null }, "ru")).toBe("1д 1ч");
  });
});
