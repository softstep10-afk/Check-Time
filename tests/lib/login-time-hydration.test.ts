import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { formatLoginStampTime } from "@/lib/login-time";

const loginPageSource = readFileSync(
  resolve(process.cwd(), "src/app/(auth)/login/page.tsx"),
  "utf8",
);

const t = (key: string) => (key === "login.clockedInAt" ? "Clocked in at" : key);

describe("login hydration-safe time display", () => {
  it("formats the success stamp deterministically from an explicit Date", () => {
    expect(formatLoginStampTime(new Date("2026-05-31T09:05:00"), t)).toBe(
      "Clocked in at 9:05 AM",
    );
    expect(formatLoginStampTime(new Date("2026-05-31T21:45:00"), t)).toBe(
      "Clocked in at 9:45 PM",
    );
  });

  it("keeps the initial login render free of render-time Date text", () => {
    expect(loginPageSource).toContain('const [stampTime, setStampTime] = useState("");');
    expect(loginPageSource).toContain("setStampTime(formatLoginStampTime(new Date(), t));");
    expect(loginPageSource).not.toContain("const now = new Date();");
    expect(loginPageSource).not.toContain("const stampTime = `");
  });
});
