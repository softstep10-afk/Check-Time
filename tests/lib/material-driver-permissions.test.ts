import { describe, expect, it } from "vitest";
import {
  canUseDriverMaterialView,
  filterMaterialDriverProfiles,
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
    const sanyaWorker = { id: "sanya", name: "Sanya", role: "worker" as const };
    const sanyaRuWorker = { id: "sanya-ru", name: "Саня", role: "worker" as const };
    const sanyaDriver = { id: "driver-sanya", name: "Sanya", role: "driver" as const };

    expect(isMaterialDriverProfile(sanyaWorker)).toBe(false);
    expect(isMaterialDriverProfile(sanyaRuWorker)).toBe(false);
    expect(isMaterialDriverProfile(sanyaDriver)).toBe(true);
  });

  it("filters material assignment choices down to drivers only", () => {
    const profiles = [
      { id: "driver-1", name: "Driver One", role: "driver" },
      { id: "worker-1", name: "Worker One", role: "worker" },
      { id: "manager-1", name: "Manager One", role: "manager" },
      { id: "supervisor-1", name: "Supervisor One", role: "supervisor" },
      { id: "owner-1", name: "Owner One", role: "owner" },
      { id: "driver-2", name: "Driver Two", role: "driver" },
    ];

    expect(filterMaterialDriverProfiles(profiles).map((profile) => profile.id)).toEqual([
      "driver-1",
      "driver-2",
    ]);
  });
});
