import { describe, it, expect } from "vitest";
import {
  classifyMime,
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

  it("returns null for unknown types", () => {
    expect(classifyMime("application/octet-stream")).toBeNull();
    expect(classifyMime("text/plain")).toBeNull();
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
});
