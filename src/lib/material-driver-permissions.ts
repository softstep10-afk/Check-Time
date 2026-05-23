import type { UserRole } from "@/types/database";

export type MaterialDriverProfileLike = {
  id?: string | null;
  role?: UserRole | string | null;
};

export function isMaterialDriverProfile(
  profile: MaterialDriverProfileLike | null | undefined,
): boolean {
  return profile?.role === "driver";
}

export function canUseDriverMaterialView(
  profile: MaterialDriverProfileLike | null | undefined,
): boolean {
  return isMaterialDriverProfile(profile);
}

export function shouldFilterWorkerTasksToMaterials(
  profile: MaterialDriverProfileLike | null | undefined,
): boolean {
  return isMaterialDriverProfile(profile);
}
