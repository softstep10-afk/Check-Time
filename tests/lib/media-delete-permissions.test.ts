import { describe, expect, it } from "vitest";
import {
  canDeleteMediaEverywhere,
  normalizeMediaDeleteName,
  parseMediaDeleteProfileIds,
} from "@/lib/media-delete-permissions";

describe("media delete permissions", () => {
  it("allows Andrey and Sergey owner/admin identities", () => {
    expect(canDeleteMediaEverywhere({ id: "a", name: "Andrey", role: "owner" })).toBe(true);
    expect(canDeleteMediaEverywhere({ id: "s", name: "Сергей", role: "admin" })).toBe(true);
    expect(canDeleteMediaEverywhere({ id: "a", name: "Андрей Иванов", role: "owner" })).toBe(true);
    expect(canDeleteMediaEverywhere({ id: "s", name: "Sergey Petrov", role: "admin" })).toBe(true);
  });

  it("rejects broad role-only access", () => {
    expect(canDeleteMediaEverywhere({ id: "manager", name: "Manager", role: "manager" })).toBe(false);
    expect(canDeleteMediaEverywhere({ id: "supervisor", name: "Andrey", role: "supervisor" })).toBe(false);
    expect(canDeleteMediaEverywhere({ id: "worker", name: "Sergey", role: "worker" })).toBe(false);
    expect(canDeleteMediaEverywhere({ id: "admin", name: "Other Admin", role: "admin" })).toBe(false);
    expect(canDeleteMediaEverywhere(null)).toBe(false);
  });

  it("supports stable configured ids without broadening roles", () => {
    const ids = parseMediaDeleteProfileIds(" profile-a,PROFILE-B ");
    expect(canDeleteMediaEverywhere({ id: "profile-a", name: "Other", role: "worker" }, { allowedProfileIds: ids })).toBe(true);
    expect(canDeleteMediaEverywhere({ id: "profile-b", name: "Other", role: "admin" }, { allowedProfileIds: ids })).toBe(true);
    expect(canDeleteMediaEverywhere({ id: "profile-c", name: "Other", role: "admin" }, { allowedProfileIds: ids })).toBe(false);
  });

  it("normalizes only the first stable name token", () => {
    expect(normalizeMediaDeleteName(" Сергей Петров ")).toBe("сергей");
    expect(normalizeMediaDeleteName("Andrey, owner")).toBe("andrey");
    expect(normalizeMediaDeleteName("")).toBeNull();
  });
});
