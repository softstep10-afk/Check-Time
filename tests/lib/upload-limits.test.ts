import { describe, it, expect } from "vitest";
import {
  ACCEPT_ALL_UPLOADS,
  classifyMime,
  inferUploadContentType,
  STORAGE_LIMITS_MB,
  validateUploadFile,
} from "@/lib/upload-limits";

function makeFile(name: string, mime: string, sizeMb: number): File {
  // 1 KB chunk repeated to hit the requested size — cheap enough for
  // the small-MB cases we test below.
  const bytes = new Uint8Array(Math.round(sizeMb * 1024 * 1024));
  return new File([bytes], name, { type: mime });
}

describe("classifyMime", () => {
  it("recognises common photo MIMEs", () => {
    expect(classifyMime("image/jpeg")).toBe("photo");
    expect(classifyMime("image/png")).toBe("photo");
    expect(classifyMime("image/heic")).toBe("photo");
  });

  it("recognises common video MIMEs", () => {
    expect(classifyMime("video/mp4")).toBe("video");
    expect(classifyMime("video/quicktime")).toBe("video");
    expect(classifyMime("video/webm")).toBe("video");
  });

  it("recognises pdf", () => {
    expect(classifyMime("application/pdf")).toBe("pdf");
  });

  it("recognises common business document MIMEs", () => {
    expect(classifyMime("application/msword")).toBe("document");
    expect(classifyMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document")).toBe("document");
    expect(classifyMime("application/vnd.ms-excel")).toBe("document");
    expect(classifyMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")).toBe("document");
    expect(classifyMime("text/csv")).toBe("document");
    expect(classifyMime("text/plain")).toBe("document");
  });

  it("returns null for unknown types", () => {
    expect(classifyMime("application/octet-stream")).toBeNull();
    expect(classifyMime("application/x-msdownload")).toBeNull();
  });
});

describe("validateUploadFile", () => {
  it("accepts a small jpeg under the photo limit", () => {
    const file = makeFile("hello.jpg", "image/jpeg", 0.5);
    const result = validateUploadFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("photo");
  });

  it("rejects a 25 MB jpeg with a per-kind too_large error", () => {
    const file = makeFile("big.jpg", "image/jpeg", 25);
    const result = validateUploadFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.reason).toBe("too_large");
      if (result.error.reason === "too_large") {
        expect(result.error.kind).toBe("photo");
        expect(result.error.limitMb).toBe(STORAGE_LIMITS_MB.photo);
        expect(result.error.sizeMb).toBeGreaterThan(STORAGE_LIMITS_MB.photo);
      }
    }
  });

  it("rejects an unsupported MIME with unsupported_type", () => {
    const file = makeFile("script.exe", "application/x-msdownload", 0.1);
    const result = validateUploadFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.reason).toBe("unsupported_type");
  });

  it("falls back to file extension when MIME is empty", () => {
    const file = makeFile("clip.mov", "", 0.1);
    const result = validateUploadFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.kind).toBe("video");
  });

  it("accepts Word, Excel, CSV, and PDF files by extension when MIME is empty", () => {
    for (const [name, expected] of [
      ["estimate.doc", "application/msword"],
      ["scope.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
      ["materials.xls", "application/vnd.ms-excel"],
      ["takeoff.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
      ["costs.csv", "text/csv"],
      ["plans.pdf", "application/pdf"],
    ] as const) {
      const file = makeFile(name, "", 0.1);
      const result = validateUploadFile(file);
      expect(result.ok).toBe(true);
      if (result.ok && name.endsWith(".pdf")) expect(result.kind).toBe("pdf");
      if (result.ok && !name.endsWith(".pdf")) expect(result.kind).toBe("document");
      expect(inferUploadContentType(file)).toBe(expected);
    }
  });

  it("adds extensions to the shared accept filter so desktop pickers show office files", () => {
    expect(ACCEPT_ALL_UPLOADS).toContain(".pdf");
    expect(ACCEPT_ALL_UPLOADS).toContain(".docx");
    expect(ACCEPT_ALL_UPLOADS).toContain(".xlsx");
    expect(ACCEPT_ALL_UPLOADS).toContain(".csv");
  });
});
