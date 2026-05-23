import type { UserRole } from "@/types/database";

export const TEAM_ASSIGNABLE_ROLES: readonly UserRole[] = [
  "worker",
  "supervisor",
  "driver",
  "sales",
  "subcontractor",
  "manager",
  "admin",
];

export const TEAM_PROFILE_ROLES: readonly UserRole[] = [
  ...TEAM_ASSIGNABLE_ROLES,
  "owner",
];

export function isOwnerAdminRole(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function isTeamAssignableRole(value: unknown): value is UserRole {
  return typeof value === "string" && TEAM_ASSIGNABLE_ROLES.includes(value as UserRole);
}

export function isTeamProfileRole(value: unknown): value is UserRole {
  return typeof value === "string" && TEAM_PROFILE_ROLES.includes(value as UserRole);
}

export function canAssignDriverRole(
  actorRole: UserRole | null | undefined,
): boolean {
  return isOwnerAdminRole(actorRole);
}

export function canCreateTeamRole(
  actorRole: UserRole | null | undefined,
  targetRole: UserRole,
): boolean {
  if (targetRole === "driver") {
    return canAssignDriverRole(actorRole);
  }

  if (!isOwnerAdminRole(targetRole)) {
    return true;
  }

  return isOwnerAdminRole(actorRole);
}

export function canUpdateTeamRole(
  actorRole: UserRole | null | undefined,
  currentRole: UserRole | null | undefined,
  nextRole: UserRole,
): boolean {
  if (currentRole === nextRole) {
    return true;
  }

  return isOwnerAdminRole(actorRole);
}

export function canManageTeamMember(
  actorRole: UserRole | null | undefined,
  targetRole: UserRole | null | undefined,
): boolean {
  if (!isOwnerAdminRole(targetRole)) {
    return true;
  }

  return isOwnerAdminRole(actorRole);
}

export function canConfirmJarvisWriteAction(
  actorRole: UserRole | null | undefined,
): boolean {
  return isOwnerAdminRole(actorRole);
}
