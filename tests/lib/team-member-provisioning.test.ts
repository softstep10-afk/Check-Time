import { describe, expect, it } from "vitest";
import {
  buildTeamMemberEmail,
  generateTeamMemberPin,
  isValidTeamPasscode,
  slugifyTeamMemberName,
} from "@/lib/team-member-provisioning";

describe("team member provisioning", () => {
  it("keeps a provided email lowercased", () => {
    expect(buildTeamMemberEmail("  Worker@Example.COM ", "Sasha", "abc")).toBe(
      "worker@example.com",
    );
  });

  it("builds a valid synthetic email for ascii names", () => {
    expect(buildTeamMemberEmail("", "Sasha Worker", "123e4567-e89b")).toBe(
      "sasha-worker-123e4567e89b@checktime.app",
    );
  });

  it("uses a synthetic email when a provided email is malformed", () => {
    expect(buildTeamMemberEmail("worker@", "Sasha Worker", "123e4567-e89b")).toBe(
      "sasha-worker-123e4567e89b@checktime.app",
    );
  });

  it("falls back safely for cyrillic names", () => {
    expect(slugifyTeamMemberName("саня")).toBe("");
    expect(buildTeamMemberEmail("", "саня", "123e4567-e89b")).toBe(
      "team-member-123e4567e89b@checktime.app",
    );
  });

  it("generates a 4 digit PIN", () => {
    expect(generateTeamMemberPin(() => 0)).toBe("1000");
    expect(generateTeamMemberPin(() => 0.9999)).toBe("9999");
  });

  it("allows stronger alphanumeric passcodes while keeping short/bad values out", () => {
    expect(isValidTeamPasscode("1234")).toBe(true);
    expect(isValidTeamPasscode("Andrei77")).toBe(true);
    expect(isValidTeamPasscode("abc")).toBe(false);
    expect(isValidTeamPasscode("too-long-passcode")).toBe(false);
    expect(isValidTeamPasscode("bad pin")).toBe(false);
  });
});
