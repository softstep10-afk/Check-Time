import "server-only";

import { parseMaterialDriverProfileIds } from "@/lib/material-driver-permissions";

export function readMaterialDriverProfileIdsFromEnv(): ReadonlySet<string> {
  return parseMaterialDriverProfileIds(process.env.MATERIAL_DRIVER_PROFILE_IDS);
}
