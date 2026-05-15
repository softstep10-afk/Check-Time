import { describe, expect, it } from "vitest";
import {
  appendJarvisMemoryRule,
  detectJarvisMemoryInstruction,
  formatJarvisAttachmentsForPrompt,
  hasJarvisImageData,
  normalizeJarvisAttachments,
  readJarvisMemory,
  removeJarvisMemoryRule,
} from "@/lib/ai/jarvis-memory";

describe("Jarvis memory", () => {
  it("detects Russian and English memory commands", () => {
    expect(detectJarvisMemoryInstruction("запомни: Васю ставить на шпаклевку")).toBe(
      "Васю ставить на шпаклевку",
    );
    expect(detectJarvisMemoryInstruction("remember: never close payroll before shift review")).toBe(
      "never close payroll before shift review",
    );
  });

  it("stores, de-duplicates, and removes org rules inside settings", () => {
    const org = { settings: {} };
    const first = appendJarvisMemoryRule({
      org,
      text: "Always check checkout videos before payroll.",
      createdBy: "owner",
      source: "manual",
      now: "2026-05-14T00:00:00.000Z",
    });
    const duplicate = appendJarvisMemoryRule({
      org: { settings: first.settings },
      text: "Always check checkout videos before payroll.",
      createdBy: "owner",
      source: "chat",
      now: "2026-05-14T00:01:00.000Z",
    });

    expect(readJarvisMemory(duplicate.settings)).toHaveLength(1);
    const removed = removeJarvisMemoryRule(duplicate.settings, first.rule.id);
    expect(readJarvisMemory(removed.settings)).toHaveLength(0);
  });

  it("normalizes readable attachment metadata", () => {
    const attachments = normalizeJarvisAttachments([
      { filename: "scope.csv", mimeType: "text/csv", content: "line 1\nline 2" },
      { filename: "", content: "ignored" },
    ]);

    expect(attachments).toEqual([
      { filename: "scope.csv", mimeType: "text/csv", content: "line 1\nline 2", dataUrl: null },
    ]);
  });

  it("keeps safe image data URLs for multimodal Jarvis requests", () => {
    const dataUrl = "data:image/png;base64,iVBORw0KGgo=";
    const attachments = normalizeJarvisAttachments([
      { filename: "field.png", mimeType: "image/png", content: null, dataUrl },
      { filename: "unsafe.svg", mimeType: "image/svg+xml", dataUrl: "data:image/svg+xml;base64,PHN2Zy8+" },
    ]);

    expect(attachments).toEqual([
      { filename: "field.png", mimeType: "image/png", content: null, dataUrl },
      { filename: "unsafe.svg", mimeType: "image/svg+xml", content: null, dataUrl: null },
    ]);
    expect(hasJarvisImageData(attachments)).toBe(true);
    expect(formatJarvisAttachmentsForPrompt(attachments)).toContain("direct visual inspection");
  });
});
