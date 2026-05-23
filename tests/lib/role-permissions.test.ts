import { describe, expect, it } from "vitest";
import {
  canConfirmJarvisWriteAction,
  canCreateTeamRole,
  canManageTeamMember,
  canUpdateTeamRole,
  isOwnerAdminRole,
  isTeamAssignableRole,
  isTeamProfileRole,
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

  it("keeps operational team creation available while reserving driver/admin for owner-admin setup", () => {
    for (const targetRole of operationalRoles.filter((role) => role !== "driver")) {
      expect(canCreateTeamRole("manager", targetRole)).toBe(true);
      expect(canCreateTeamRole("supervisor", targetRole)).toBe(true);
    }

    expect(canCreateTeamRole("manager", "driver")).toBe(false);
    expect(canCreateTeamRole("supervisor", "driver")).toBe(false);
    expect(canCreateTeamRole("worker", "driver")).toBe(false);
    expect(canCreateTeamRole("owner", "driver")).toBe(true);
    expect(canCreateTeamRole("admin", "driver")).toBe(true);
    expect(canCreateTeamRole("manager", "admin")).toBe(false);
    expect(canCreateTeamRole("supervisor", "admin")).toBe(false);
    expect(canCreateTeamRole("owner", "admin")).toBe(true);
    expect(canCreateTeamRole("admin", "admin")).toBe(true);
  });

  it("allows only owner/admin to change existing profile roles", () => {
    expect(canUpdateTeamRole("owner", "worker", "driver")).toBe(true);
    expect(canUpdateTeamRole("admin", "worker", "driver")).toBe(true);
    expect(canUpdateTeamRole("manager", "worker", "driver")).toBe(false);
    expect(canUpdateTeamRole("supervisor", "worker", "driver")).toBe(false);
    expect(canUpdateTeamRole("worker", "worker", "driver")).toBe(false);
    expect(canUpdateTeamRole("manager", "driver", "driver")).toBe(true);
    expect(canUpdateTeamRole("manager", "driver", "worker")).toBe(false);
    expect(canUpdateTeamRole("manager", "worker", "supervisor")).toBe(false);
    expect(canUpdateTeamRole("owner", "worker", "supervisor")).toBe(true);
    expect(canUpdateTeamRole("owner", "driver", "worker")).toBe(true);
  });

  it("recognizes driver as an existing editable profile role but not a new owner role", () => {
    expect(isTeamAssignableRole("driver")).toBe(true);
    expect(isTeamAssignableRole("owner")).toBe(false);
    expect(isTeamProfileRole("driver")).toBe(true);
    expect(isTeamProfileRole("owner")).toBe(true);
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
