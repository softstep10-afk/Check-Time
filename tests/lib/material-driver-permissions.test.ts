import { describe, expect, it } from "vitest";
import {
  canUseDriverMaterialView,
  isMaterialDriverProfile,
  shouldFilterWorkerTasksToMaterials,
} from "@/lib/material-driver-permissions";

describe("material driver permissions", () => {
  it("allows the existing driver role to use the focused material view", () => {
    const profile = { id: "driver-1", role: "driver" };

    expect(isMaterialDriverProfile(profile)).toBe(true);
    expect(canUseDriverMaterialView(profile)).toBe(true);
    expect(shouldFilterWorkerTasksToMaterials(profile)).toBe(true);
  });

  it("does not make managers, supervisors, or workers material drivers automatically", () => {
    for (const role of ["manager", "supervisor", "worker", "admin", "owner"] as const) {
      expect(isMaterialDriverProfile({ id: `${role}-1`, role })).toBe(false);
      expect(shouldFilterWorkerTasksToMaterials({ id: `${role}-1`, role })).toBe(false);
    }
  });

  it("rejects missing or unknown profiles", () => {
    expect(isMaterialDriverProfile(null)).toBe(false);
    expect(isMaterialDriverProfile(undefined)).toBe(false);
    expect(isMaterialDriverProfile({ id: "unknown", role: null })).toBe(false);
  });

  it("does not rely on a hardcoded display name", () => {
    expect(isMaterialDriverProfile({ id: "sanya", role: "worker" })).toBe(false);
  });
});
