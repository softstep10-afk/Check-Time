import type { UserRole } from "@/types/database";

/**
 * Role hierarchy (higher number = more power):
 *   worker(0) < driver(1) < subcontractor(1) < supervisor(2) < manager(3) < admin(4) < owner(5)
 */
const ROLE_POWER: Record<UserRole, number> = {
  worker: 0,
  driver: 1,
  subcontractor: 1,
  supervisor: 2,
  manager: 3,
  admin: 4,
  owner: 5,
};

/**
 * Public alias of ROLE_POWER. Callers that only need to compare roles
 * by rank (schedule UI, manager filters, etc.) can read this directly
 * instead of importing the helper functions — works for any string
 * input, not just the UserRole union.
 */
export const ROLE_HIERARCHY: Record<string, number> = ROLE_POWER;

export function isOwner(role: UserRole): boolean {
  return role === "owner";
}

export function isManagerOrAbove(role: UserRole): boolean {
  return ROLE_POWER[role] >= ROLE_POWER.manager;
}

export function isOwnerOrAdmin(role: UserRole): boolean {
  return role === "owner" || role === "admin";
}

export function canManageRole(actorRole: UserRole, targetRole: UserRole): boolean {
  return ROLE_POWER[actorRole] > ROLE_POWER[targetRole];
}

export function rolePower(role: UserRole): number {
  return ROLE_POWER[role] ?? 0;
}

/** Roles a given actor is allowed to assign to others */
export function assignableRoles(actorRole: UserRole): UserRole[] {
  const power = ROLE_POWER[actorRole];
  return (Object.entries(ROLE_POWER) as [UserRole, number][])
    .filter(([, p]) => p < power)
    .map(([r]) => r);
}
