import { describe, expect, it } from "vitest";
import {
  canConfirmJarvisWriteAction,
  canCreateTeamRole,
  canManageTeamMember,
  isOwnerAdminRole,
} from "@/lib/role-permissions";
import type { UserRole } from "@/types/database";

const operationalRoles: UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "sales",
  "subcontractor",
  "manager",
];

describe("role permission guardrails", () => {
  it("recognizes owner/admin as elevated roles", () => {
    expect(isOwnerAdminRole("owner")).toBe(true);
    expect(isOwnerAdminRole("admin")).toBe(true);
    expect(isOwnerAdminRole("manager")).toBe(false);
    expect(isOwnerAdminRole("worker")).toBe(false);
  });

  it("keeps operational team creation available while blocking admin creation", () => {
    for (const targetRole of operationalRoles) {
      expect(canCreateTeamRole("manager", targetRole)).toBe(true);
      expect(canCreateTeamRole("supervisor", targetRole)).toBe(true);
    }

    expect(canCreateTeamRole("manager", "admin")).toBe(false);
    expect(canCreateTeamRole("supervisor", "admin")).toBe(false);
    expect(canCreateTeamRole("owner", "admin")).toBe(true);
    expect(canCreateTeamRole("admin", "admin")).toBe(true);
  });

  it("protects owner/admin team members from non-owner administrative actions", () => {
    expect(canManageTeamMember("manager", "owner")).toBe(false);
    expect(canManageTeamMember("manager", "admin")).toBe(false);
    expect(canManageTeamMember("supervisor", "admin")).toBe(false);
    expect(canManageTeamMember("owner", "admin")).toBe(true);
    expect(canManageTeamMember("admin", "owner")).toBe(true);
    expect(canManageTeamMember("manager", "worker")).toBe(true);
    expect(canManageTeamMember("supervisor", "worker")).toBe(true);
  });

  it("aligns Jarvis write confirmation to owner/admin only", () => {
    expect(canConfirmJarvisWriteAction("owner")).toBe(true);
    expect(canConfirmJarvisWriteAction("admin")).toBe(true);
    expect(canConfirmJarvisWriteAction("manager")).toBe(false);
    expect(canConfirmJarvisWriteAction("supervisor")).toBe(false);
    expect(canConfirmJarvisWriteAction("worker")).toBe(false);
  });
});
