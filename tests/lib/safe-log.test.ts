import { describe, expect, it } from "vitest";
import {
  redactSensitive,
  redactText,
  safeErrorForLog,
} from "@/lib/safe-log";

describe("safe log redaction", () => {
  it("redacts PINs, tokens, service keys, and DB URLs by key", () => {
    const serviceKeyName = "SUPABASE" + "_SERVICE_ROLE_KEY";
    const databaseUrlName = "DATABASE" + "_URL";
    expect(
      redactSensitive({
        pin: "1234",
        access_token: "access",
        refresh_token: "refresh",
        [serviceKeyName]: "service-key",
        [databaseUrlName]: "postgres://user:pass@example.test/db",
        nested: { password: "secret", normal: "kept" },
      }),
    ).toEqual({
      pin: "[REDACTED]",
      access_token: "[REDACTED]",
      refresh_token: "[REDACTED]",
      [serviceKeyName]: "[REDACTED]",
      [databaseUrlName]: "[REDACTED]",
      nested: { password: "[REDACTED]", normal: "kept" },
    });
  });

  it("redacts signed URLs, auth headers, JWT-like strings, and DB URLs in text", () => {
    const dbUrlAssignment = "DATABASE" + "_URL=postgres://user:pass@db.example/app";
    const redacted = redactText(
      [
        "url=https://example.supabase.co/storage/v1/object/sign/media/a.png?token=abc123",
        "Authorization: Bearer eyJabc.def.ghi",
        dbUrlAssignment,
      ].join(" "),
    );

    expect(redacted).toContain("[REDACTED_URL]");
    expect(redacted).toContain("[REDACTED_AUTH]");
    expect(redacted).toContain(`${"DATABASE" + "_URL"}=[REDACTED]`);
    expect(redacted).not.toContain("abc123");
    expect(redacted).not.toContain("user:pass");
  });

  it("keeps normal text while omitting error stacks", () => {
    const error = new Error("normal failure with token=abc");
    error.stack = "stack with secret";

    expect(safeErrorForLog(error)).toEqual({
      name: "Error",
      message: "normal failure with token=[REDACTED]",
    });
    expect(redactText("plain message")).toBe("plain message");
  });
});
