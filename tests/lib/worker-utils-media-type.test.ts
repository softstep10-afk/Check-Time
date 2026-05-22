import { describe, expect, it } from "vitest";
import { guessMediaType } from "@/lib/worker-utils";

function makeFile(name: string, mime: string): File {
  return new File(["x"], name, { type: mime });
}

describe("guessMediaType", () => {
  it("classifies supported media by MIME", () => {
    expect(guessMediaType(makeFile("photo.jpg", "image/jpeg"))).toBe("photo");
    expect(guessMediaType(makeFile("clip.mov", "video/quicktime"))).toBe("video");
    expect(guessMediaType(makeFile("plans.pdf", "application/pdf"))).toBe("pdf");
    expect(
      guessMediaType(
        makeFile(
          "scope.docx",
          "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ),
      ),
    ).toBe("document");
  });

  it("uses extension fallback when file pickers return generic MIME", () => {
    expect(guessMediaType(makeFile("iphone.MOV", "application/octet-stream"))).toBe("video");
    expect(guessMediaType(makeFile("photo.HEIC", "application/octet-stream"))).toBe("photo");
    expect(guessMediaType(makeFile("plans.PDF", ""))).toBe("pdf");
  });
});
