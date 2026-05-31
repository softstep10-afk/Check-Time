import packageJson from "../../package.json";

export type ReleaseDiagnostics = {
  appVersion: string;
  commitSha: string;
  commitShort: string;
  branch: string;
  buildTime: string;
  deployEnvironment: string;
  vercelUrl: string | null;
  nodeEnv: string;
};

const bundledReleaseEnv: Record<string, string | undefined> = {
  APP_BUILD_COMMIT_SHA: process.env.APP_BUILD_COMMIT_SHA,
  APP_BUILD_COMMIT_REF: process.env.APP_BUILD_COMMIT_REF,
  APP_BUILD_TIME: process.env.APP_BUILD_TIME,
  APP_DEPLOY_ENV: process.env.APP_DEPLOY_ENV,
  APP_DEPLOYMENT_URL: process.env.APP_DEPLOYMENT_URL,
};

function readEnv(env: NodeJS.ProcessEnv, keys: string[], fallback = "unknown"): string {
  for (const key of keys) {
    const value = env[key] ?? bundledReleaseEnv[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

function normalizedUrl(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function getReleaseDiagnostics(env: NodeJS.ProcessEnv = process.env): ReleaseDiagnostics {
  const commitSha = readEnv(env, [
    "APP_BUILD_COMMIT_SHA",
    "VERCEL_GIT_COMMIT_SHA",
    "GIT_COMMIT_SHA",
    "COMMIT_SHA",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  ]);
  const buildTime = readEnv(env, ["APP_BUILD_TIME", "NEXT_BUILD_TIME"]);
  const deploymentUrl = readEnv(env, ["APP_DEPLOYMENT_URL", "VERCEL_URL"], "");

  return {
    appVersion: packageJson.version,
    commitSha,
    commitShort: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 8),
    branch: readEnv(env, ["APP_BUILD_COMMIT_REF", "VERCEL_GIT_COMMIT_REF", "GIT_BRANCH", "BRANCH"]),
    buildTime,
    deployEnvironment: readEnv(env, ["APP_DEPLOY_ENV", "VERCEL_ENV", "DEPLOY_ENV", "NODE_ENV"]),
    vercelUrl: normalizedUrl(deploymentUrl),
    nodeEnv: readEnv(env, ["NODE_ENV"]),
  };
}
