import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function read(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const route = read("src/app/api/profile/language/route.ts");
const helper = read("src/lib/i18n/persist-locale.ts");
const context = read("src/lib/i18n/context.tsx");
const workerShell = read("src/components/worker/WorkerShell.tsx");

describe("worker language persistence — server route", () => {
  it("is auth-gated and derives the profile id from the session (never the client)", () => {
    expect(route).toContain("supabase.auth.getUser()");
    expect(route).toContain("{ status: 401 }");
    // Server-derived identity: the update is scoped to the session user's id.
    expect(route).toContain('.eq("id", user.id)');
  });

  it("validates the locale server-side to the supported set", () => {
    expect(route).toContain('value === "en" || value === "ru"');
    expect(route).toContain("{ status: 400 }");
  });

  it("writes only the language column", () => {
    expect(route).toContain("update({ language: locale })");
  });
});

describe("worker language persistence — client wiring", () => {
  it("posts fire-and-forget to the profile-language route and swallows errors", () => {
    expect(helper).toContain('"/api/profile/language"');
    expect(helper).toContain('method: "POST"');
    expect(helper).toContain(".catch(");
  });

  it("LanguageSwitcher persists the new locale on change (all roles that render it)", () => {
    expect(context).toContain("persistProfileLocale(next)");
    // RED LINE: the instant UI switch (localStorage + cookie) is preserved.
    expect(context).toContain("setLocale(next)");
  });

  it("WorkerShell boot-syncs the device locale to the profile once when they differ", () => {
    expect(workerShell).toContain("languageSyncedRef");
    expect(workerShell).toContain("locale !== shell.profile.language");
    expect(workerShell).toContain("persistProfileLocale(locale)");
  });
});
