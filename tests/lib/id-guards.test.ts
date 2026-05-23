import { describe, expect, it } from "vitest";
import {
  readOptionalUuid,
  readRequiredUuid,
  readUuid,
  readUuidArray,
} from "@/lib/server/id-guards";

const uuidA = "11111111-1111-4111-8111-111111111111";
const uuidB = "22222222-2222-4222-8222-222222222222";

describe("id guards", () => {
  it("accepts canonical UUID strings", () => {
    expect(readUuid(uuidA)).toBe(uuidA);
    expect(readRequiredUuid(uuidA, "project id")).toEqual({
      ok: true,
      value: uuidA,
    });
  });

  it("rejects empty, missing, and non-UUID ids", () => {
    expect(readUuid("project-1")).toBeNull();
    expect(readRequiredUuid("", "project id")).toEqual({
      ok: false,
      error: "Invalid project id.",
      status: 400,
    });
    expect(readRequiredUuid(null, "task id")).toEqual({
      ok: false,
      error: "Invalid task id.",
      status: 400,
    });
  });

  it("treats blank optional ids as null and rejects spoofed values", () => {
    expect(readOptionalUuid("", "assignee id")).toEqual({
      ok: true,
      value: null,
    });
    expect(readOptionalUuid(undefined, "assignee id")).toEqual({
      ok: true,
      value: null,
    });
    expect(readOptionalUuid("worker-1", "assignee id")).toEqual({
      ok: false,
      error: "Invalid assignee id.",
      status: 400,
    });
  });

  it("dedupes UUID arrays and rejects invalid entries before mutation", () => {
    expect(readUuidArray([uuidA, uuidB, uuidA], { label: "media id" })).toEqual({
      ok: true,
      value: [uuidA, uuidB],
    });
    expect(readUuidArray([uuidA, "media-1"], { label: "media id" })).toEqual({
      ok: false,
      error: "Invalid media id.",
      status: 400,
    });
  });
});
