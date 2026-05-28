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

function readEnv(env: NodeJS.ProcessEnv, keys: string[], fallback = "unknown"): string {
  for (const key of keys) {
    const value = env[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
}

export function getReleaseDiagnostics(env: NodeJS.ProcessEnv = process.env): ReleaseDiagnostics {
  const commitSha = readEnv(env, [
    "VERCEL_GIT_COMMIT_SHA",
    "GIT_COMMIT_SHA",
    "COMMIT_SHA",
    "NEXT_PUBLIC_VERCEL_GIT_COMMIT_SHA",
  ]);
  const buildTime = readEnv(env, ["APP_BUILD_TIME", "NEXT_BUILD_TIME"]);
  const vercelUrl = readEnv(env, ["VERCEL_URL"], "");

  return {
    appVersion: packageJson.version,
    commitSha,
    commitShort: commitSha === "unknown" ? "unknown" : commitSha.slice(0, 8),
    branch: readEnv(env, ["VERCEL_GIT_COMMIT_REF", "GIT_BRANCH", "BRANCH"]),
    buildTime,
    deployEnvironment: readEnv(env, ["VERCEL_ENV", "DEPLOY_ENV", "NODE_ENV"]),
    vercelUrl: vercelUrl ? `https://${vercelUrl}` : null,
    nodeEnv: readEnv(env, ["NODE_ENV"]),
  };
}
