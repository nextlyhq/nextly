import path from "path";

import fs from "fs-extra";

import type { PackageManager, ProjectInfo } from "../types";

/**
 * Detect the package manager used in the project.
 */
export async function detectPackageManager(
  cwd: string
): Promise<PackageManager> {
  if (await fs.pathExists(path.join(cwd, "pnpm-lock.yaml"))) return "pnpm";
  if (await fs.pathExists(path.join(cwd, "yarn.lock"))) return "yarn";
  if (await fs.pathExists(path.join(cwd, "bun.lockb"))) return "bun";
  return "npm";
}

/**
 * Detect project configuration and validate Next.js setup.
 */
export async function detectProject(cwd: string): Promise<ProjectInfo> {
  const packageJsonPath = path.join(cwd, "package.json");

  if (!(await fs.pathExists(packageJsonPath))) {
    throw new Error(
      "No package.json found. Please run this command in a Next.js project."
    );
  }

  const packageJson = await fs.readJson(packageJsonPath);
  const deps = {
    ...packageJson.dependencies,
    ...packageJson.devDependencies,
  };

  // Check for Next.js
  const isNextJs = "next" in deps;
  if (!isNextJs) {
    throw new Error(
      "Next.js not found in dependencies. Please run this in a Next.js project."
    );
  }

  // Detect Next.js version
  const nextVersion = deps.next?.replace(/[\^~]/, "") || null;

  // Detect src directory
  const srcDir = await fs.pathExists(path.join(cwd, "src"));

  // Detect App Router
  const appDirPaths = srcDir
    ? [path.join(cwd, "src", "app")]
    : [path.join(cwd, "app")];

  let isAppRouter = false;
  for (const appPath of appDirPaths) {
    if (await fs.pathExists(appPath)) {
      isAppRouter = true;
      break;
    }
  }

  if (!isAppRouter) {
    throw new Error(
      "App Router not detected. Nextly requires Next.js App Router (app/ directory)."
    );
  }

  // Detect TypeScript
  const hasTypescript = await fs.pathExists(path.join(cwd, "tsconfig.json"));

  // Detect package manager
  const packageManager = await detectPackageManager(cwd);

  // Determine app directory
  const appDir = srcDir ? "src/app" : "app";

  return {
    isNextJs,
    isAppRouter,
    hasTypescript,
    packageManager,
    nextVersion,
    srcDir,
    appDir,
  };
}
