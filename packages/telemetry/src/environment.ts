import { existsSync, readFileSync } from "fs";
import { arch as osArch, platform as osPlatform } from "os";

import { TELEMETRY_SCHEMA_VERSION } from "./constants.js";
import type {
  ArchName,
  BaseContext,
  CliName,
  OsName,
  PackageManager,
} from "./events.js";

export function detectOs(): OsName {
  const p = osPlatform();
  if (p === "darwin" || p === "linux" || p === "win32" || p === "freebsd")
    return p;
  return "other";
}

export function detectArch(): ArchName {
  const a = osArch();
  if (a === "arm64" || a === "x64") return a;
  return "other";
}

// npm, pnpm, yarn, bun all set npm_config_user_agent when invoking scripts.
// Example value: "pnpm/9.12.0 npm/? node/v22.11.0 darwin arm64"
export function detectPackageManager(
  env: NodeJS.ProcessEnv = process.env
): PackageManager {
  const ua = env.npm_config_user_agent ?? "";
  if (ua.startsWith("pnpm/")) return "pnpm";
  if (ua.startsWith("yarn/")) return "yarn";
  if (ua.startsWith("bun/")) return "bun";
  if (ua.startsWith("npm/")) return "npm";
  return "unknown";
}

const CI_ENV_VARS = [
  "CI",
  "GITHUB_ACTIONS",
  "GITLAB_CI",
  "CIRCLECI",
  "TRAVIS",
  "JENKINS_URL",
  "BUILDKITE",
  "VERCEL",
  "NETLIFY",
  "RENDER",
] as const;

export function detectIsCi(env: NodeJS.ProcessEnv = process.env): boolean {
  return CI_ENV_VARS.some(key => {
    const v = env[key];
    return typeof v === "string" && v.length > 0 && v !== "0" && v !== "false";
  });
}

// Docker detection via /.dockerenv (the canonical check) plus a cgroup fallback.
// Wrapped in try/catch because filesystem reads can throw on exotic systems.
export function detectIsDocker(): boolean {
  try {
    if (existsSync("/.dockerenv")) return true;
    const cgroup = readFileSync("/proc/self/cgroup", "utf8");
    return cgroup.includes("docker") || cgroup.includes("containerd");
  } catch {
    return false;
  }
}

export function collectBaseContext(
  cli: CliName,
  cliVersion: string
): BaseContext {
  return {
    cli_name: cli,
    cli_version: cliVersion,
    node_version: process.versions.node,
    os: detectOs(),
    arch: detectArch(),
    package_manager: detectPackageManager(),
    is_ci: detectIsCi(),
    is_docker: detectIsDocker(),
    schema_version: TELEMETRY_SCHEMA_VERSION,
  };
}
