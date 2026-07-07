import { spawnSync } from "node:child_process";
import { createSerwistRoute } from "@serwist/turbopack";

// Build identity for the service worker. Prefer the same APP_BUILD_COMMIT_SHA
// the rest of the app is stamped with (injected via next.config `env`), fall
// back to the local git HEAD, then to a dev sentinel. This value is baked into
// the SW bundle as `__APP_BUILD_SHA__` (esbuild define, below) and drives the
// versioned cache names — so a new deploy uses fresh caches and controlled
// clients can read the running SW's version (Task 3 compares it).
const buildSha =
  process.env.APP_BUILD_COMMIT_SHA?.trim() ||
  spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf-8" }).stdout?.trim() ||
  "dev";

// The Serwist route bundles src/app/sw.ts with esbuild on demand and serves the
// worker + its chunks under /serwist/*. No public/sw.js is emitted (in-memory
// build), so there is nothing to .gitignore.
export const { dynamic, dynamicParams, revalidate, generateStaticParams, GET } =
  createSerwistRoute({
    swSrc: "src/app/sw.ts",
    useNativeEsbuild: true,
    esbuildOptions: {
      define: {
        __APP_BUILD_SHA__: JSON.stringify(buildSha),
        // VAPID public key for the SW's pushsubscriptionchange re-subscribe path
        // (Push Phase 1). Empty string when unset → the handler no-ops.
        __WEB_PUSH_VAPID_PUBLIC_KEY__: JSON.stringify(
          process.env.NEXT_PUBLIC_WEB_PUSH_VAPID_PUBLIC_KEY?.trim() ?? "",
        ),
      },
    },
  });
