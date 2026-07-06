import { execSync } from "node:child_process";
import type { NextConfig } from "next";

function safeEnv(...keys: string[]): string | undefined {
  for (const key of keys) {
    const value = process.env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

function safeGit(command: string): string | undefined {
  try {
    const value = execSync(command, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    return value || undefined;
  } catch {
    return undefined;
  }
}

const buildCommitSha =
  safeEnv("VERCEL_GIT_COMMIT_SHA", "GIT_COMMIT_SHA", "COMMIT_SHA", "GITHUB_SHA") ??
  safeGit("git rev-parse HEAD");
const buildCommitRef =
  safeEnv("VERCEL_GIT_COMMIT_REF", "GIT_BRANCH", "BRANCH", "GITHUB_REF_NAME") ??
  safeGit("git rev-parse --abbrev-ref HEAD");
const buildDeploymentUrl = safeEnv("VERCEL_URL", "NEXT_PUBLIC_VERCEL_URL");
const buildDeployEnvironment = safeEnv("VERCEL_ENV", "DEPLOY_ENV", "NODE_ENV");
const buildTime = safeEnv("APP_BUILD_TIME", "NEXT_BUILD_TIME") ?? new Date().toISOString();

const nextConfig: NextConfig = {
  env: {
    APP_BUILD_COMMIT_SHA: buildCommitSha ?? "",
    APP_BUILD_COMMIT_REF: buildCommitRef ?? "",
    APP_BUILD_TIME: buildTime,
    APP_DEPLOY_ENV: buildDeployEnvironment ?? "",
    APP_DEPLOYMENT_URL: buildDeploymentUrl ?? "",
  },
  experimental: {
    viewTransition: true,
  },
  // Next 16's dev server blocks cross-origin requests for HMR, RSC
  // payloads, and static assets unless the origin is on this list.
  // When the browser opens the app at 127.0.0.1 (or `localhost`) but
  // `next dev` binds 0.0.0.0, the host header (127.0.0.1) is "cross
  // origin" relative to the bind address — the RSC stream gets cut,
  // hydration never finishes, and every click looks dead.
  //
  // Listing all the loopback aliases plus the LAN IP for phones on
  // the same Wi-Fi covers desktop, mobile, and headless-Chrome
  // testing without further opt-in.
  allowedDevOrigins: [
    "127.0.0.1",
    "127.0.0.1:3000",
    "localhost",
    "localhost:3000",
    "10.0.0.55",
    "10.0.0.55:3000",
  ],
};

export default nextConfig;
