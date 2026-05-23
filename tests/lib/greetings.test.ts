import { describe, expect, it } from "vitest";
import { translations } from "@/lib/i18n/translations";

describe("role-appropriate greetings", () => {
  it("worker greeting uses the person's name instead of a raw role label", () => {
    const text = translations["worker.headerGreeting"].ru.replace("{name}", "Андрей");

    expect(text).toContain("Андрей");
    expect(text).not.toContain("Worker");
    expect(text).not.toContain("Supervisor");
  });

  it("manager and owner greetings are deterministic and name-based", () => {
    const manager = translations["manager.headerGreeting"].ru.replace("{name}", "Сергей");
    const owner = translations["owner.headerGreeting"].ru.replace("{name}", "Андрей");

    expect(manager).toContain("Сергей");
    expect(owner).toContain("Андрей");
    expect(manager).not.toContain("Manager");
    expect(owner).not.toContain("Owner");
  });

  it("project navigation exposes a clear Russian go action", () => {
    expect(translations["projects.goNow"].ru).toBe("В путь");
  });
});
