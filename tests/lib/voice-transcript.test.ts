import { describe, expect, it } from "vitest";
import { appendVoiceTranscript } from "@/lib/voice-transcript";

describe("appendVoiceTranscript", () => {
  it("appends a new spoken phrase", () => {
    expect(appendVoiceTranscript("Frame is done", "send photos")).toBe(
      "Frame is done send photos",
    );
  });

  it("does not append the same phrase twice at the end", () => {
    expect(appendVoiceTranscript("Frame is done", "Frame is done")).toBe("Frame is done");
    expect(appendVoiceTranscript("Need delivery tomorrow", "delivery tomorrow")).toBe(
      "Need delivery tomorrow",
    );
  });

  it("normalizes punctuation and spacing before duplicate checks", () => {
    expect(appendVoiceTranscript("Нужно купить материал.", "  купить   материал ")).toBe(
      "Нужно купить материал.",
    );
  });

  it("merges overlapping cumulative mobile dictation instead of repeating it", () => {
    expect(appendVoiceTranscript("Гипс 5", "Гипс 5 листов")).toBe("Гипс 5 листов");
    expect(appendVoiceTranscript("Гипс 5", "5 листов 5/8")).toBe("Гипс 5 листов 5/8");
  });
});
