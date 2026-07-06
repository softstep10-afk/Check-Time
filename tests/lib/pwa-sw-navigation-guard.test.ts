import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

function readSource(path: string): string {
  return readFileSync(resolve(process.cwd(), path), "utf8");
}

const sw = readSource("src/app/sw.ts");

// PWA Task 2.1 guardrail. The first PWA release was reverted (2b62ed3) because
// the service worker let Serwist route navigation / RSC (flight) requests, which
// buffered Next.js's streamed responses and stalled SPA navigation (5-23s). This
// test fails if sw.ts ever regains a handler that could match a navigation or RSC
// request — navigations and ALL RSC traffic must bypass the SW entirely.
describe("service worker never handles navigations or RSC (Task 2.1)", () => {
  it("has an explicit navigation + RSC predicate covering every RSC signal", () => {
    expect(sw).toContain("isNavigationOrRscRequest");
    // Document navigations.
    expect(sw).toContain('request.mode === "navigate"');
    expect(sw).toContain('request.destination === "document"');
    // RSC / flight soft-navigation signals (destination is "" for these).
    expect(sw).toContain('request.headers.has("RSC")');
    expect(sw).toContain('request.headers.has("Next-Router-State-Tree")');
    expect(sw).toContain('request.headers.has("Next-Url")');
    expect(sw).toContain('url.searchParams.has("_rsc")');
    expect(sw).toContain("text/x-component");
  });

  it("applies the navigation/RSC exclusion to every runtime matcher", () => {
    // Each `matcher: ({...}) => ...` must call `!isNavigationOrRscRequest(...)`.
    const matchers = sw.match(/matcher:\s*\(\{[^}]*\}\)\s*=>[\s\S]*?handler:/g) ?? [];
    expect(matchers.length).toBeGreaterThan(0);
    for (const matcher of matchers) {
      expect(matcher).toContain("!isNavigationOrRscRequest(");
    }
  });

  it("does not register precache or any navigation-serving handler", () => {
    // Precache removed — its PrecacheRoute registers cleanURLs/directoryIndex
    // heuristics that evaluate navigation URLs.
    expect(sw).not.toContain("precacheEntries");
    expect(sw).not.toContain("__SW_MANIFEST");
    // No navigation fallback / catch-all / default handler / broad Next cache.
    expect(sw).not.toContain("fallbacks");
    expect(sw).not.toContain("NavigationRoute");
    expect(sw).not.toContain("setDefaultHandler");
    expect(sw).not.toContain("setCatchHandler");
    expect(sw).not.toContain("defaultCache");
    // navigationPreload stays off (it only matters when a nav handler exists).
    expect(sw).toContain("navigationPreload: false");
  });
});
