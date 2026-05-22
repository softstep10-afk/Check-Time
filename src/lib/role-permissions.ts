import type { UserRole } from "@/types/database";

export function isOwnerAdminRole(role: UserRole | null | undefined): boolean {
  return role === "owner" || role === "admin";
}

export function canCreateTeamRole(
  actorRole: UserRole | null | undefined,
  targetRole: UserRole,
): boolean {
  if (!isOwnerAdminRole(targetRole)) {
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
