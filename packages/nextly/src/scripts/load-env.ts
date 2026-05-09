import { existsSync } from "fs";
import { join, dirname } from "path";

import { config } from "dotenv";

function findMonorepoRootWithApps(startDir = process.cwd()): string | null {
  let dir = startDir;
  while (dir !== dirname(dir)) {
    const appsPlayground = join(dir, "apps", "playground");
    if (existsSync(appsPlayground)) return dir;
    dir = dirname(dir);
  }
  return null;
}

export function loadEnv() {
  const currentDir = process.cwd();
  const monorepoRoot = findMonorepoRootWithApps(currentDir) ?? currentDir;

  // Search for .env file in multiple locations (in order of priority):
  // 1. Monorepo root
  // 2. Playground app (apps/playground/.env)
  // 3. Current directory
  const envSearchPaths = [
    join(monorepoRoot, ".env"),
    join(monorepoRoot, "apps", "playground", ".env"),
    join(currentDir, ".env"),
  ];

  let envPath: string | null = null;
  for (const path of envSearchPaths) {
    if (existsSync(path)) {
      envPath = path;
      break;
    }
  }

  if (envPath) {
    config({ path: envPath });
    console.log(`✅ Loaded environment file: ${envPath}`);
  } else {
    config();
    console.warn("⚠️ No .env files found — using process.env only");
  }
}

loadEnv();
