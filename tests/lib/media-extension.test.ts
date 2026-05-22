import { describe, expect, it } from "vitest";
import {
  buildSafeUploadName,
  extensionFromMime,
  hasFilenameExtension,
} from "@/lib/media-extension";

describe("extensionFromMime", () => {
  it("maps the common video MIME types", () => {
    expect(extensionFromMime("video/mp4")).toBe(".mp4");
    expect(extensionFromMime("video/quicktime")).toBe(".mov");
    expect(extensionFromMime("video/webm")).toBe(".webm");
    expect(extensionFromMime("video/3gpp")).toBe(".3gp");
  });

  it("maps common image and document MIME types", () => {
    expect(extensionFromMime("image/jpeg")).toBe(".jpg");
    expect(extensionFromMime("image/png")).toBe(".png");
    expect(extensionFromMime("image/heic")).toBe(".heic");
    expect(extensionFromMime("application/pdf")).toBe(".pdf");
    expect(extensionFromMime("application/msword")).toBe(".doc");
    expect(
      extensionFromMime("application/vnd.openxmlformats-officedocument.wordprocessingml.document"),
    ).toBe(".docx");
    expect(extensionFromMime("application/vnd.ms-excel")).toBe(".xls");
    expect(
      extensionFromMime("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    ).toBe(".xlsx");
    expect(extensionFromMime("application/csv")).toBe(".csv");
    expect(extensionFromMime("text/csv")).toBe(".csv");
  });

  it("is case-insensitive", () => {
    expect(extensionFromMime("VIDEO/MP4")).toBe(".mp4");
  });

  it("returns empty string for unknown or missing MIMEs", () => {
    expect(extensionFromMime("application/octet-stream")).toBe("");
    expect(extensionFromMime("")).toBe("");
    expect(extensionFromMime(null)).toBe("");
    expect(extensionFromMime(undefined)).toBe("");
  });
});

describe("hasFilenameExtension", () => {
  it("recognizes typical extensions", () => {
    expect(hasFilenameExtension("a.mp4")).toBe(true);
    expect(hasFilenameExtension("img_1234.JPG")).toBe(true);
    expect(hasFilenameExtension("doc.pdf")).toBe(true);
  });

  it("rejects names without an extension", () => {
    expect(hasFilenameExtension("checkout-1727")).toBe(false);
    expect(hasFilenameExtension("")).toBe(false);
  });
});

describe("buildSafeUploadName", () => {
  it("slugifies a normal filename and keeps the extension", () => {
    expect(
      buildSafeUploadName({ name: "IMG 1234.MOV", type: "video/quicktime" }),
    ).toBe("img-1234.mov");
  });

  it("appends a MIME-derived extension when the original name has none", () => {
    expect(
      buildSafeUploadName({ name: "checkout", type: "video/mp4" }),
    ).toBe("checkout.mp4");
  });

  it("falls back to {prefix}-{timestamp}{ext} when name is empty", () => {
    const out = buildSafeUploadName(
      { name: "", type: "video/quicktime" },
      "checkout",
    );
    expect(out).toMatch(/^checkout-\d+\.mov$/);
  });

  it("adds a document extension when the picker omits the filename", () => {
    const out = buildSafeUploadName(
      { name: "", type: "application/csv" },
      "attachment",
    );
    expect(out).toMatch(/^attachment-\d+\.csv$/);
  });

  it("uses .bin-equivalent (no extension) for unknown MIMEs with empty name", () => {
    const out = buildSafeUploadName({ name: "", type: "" }, "journal");
    expect(out).toMatch(/^journal-\d+$/);
  });

  it("does not append an extension when the original name already has one", () => {
    expect(
      buildSafeUploadName({ name: "video.mp4", type: "video/mp4" }),
    ).toBe("video.mp4");
    // Even when MIME and original extension disagree, we keep what was uploaded
    // — the user uploaded a file claiming .png, the storage path reflects that.
    expect(
      buildSafeUploadName({ name: "screenshot.png", type: "image/jpeg" }),
    ).toBe("screenshot.png");
  });
});
