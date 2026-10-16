import path from "path";

import fs from "fs-extra";

import type { PackageManager, ProjectInfo } from "../types";

import { detectPmFromUserAgent } from "./detect-pm-from-user-agent";
import { findWorkspaceRoot, lockfileManager } from "./workspace";

/**
 * Detect the package manager used in the project.
 *
 * A lockfile in `cwd` decides first: it says which manager installs this
 * project, while `npm_config_user_agent` only says which one launched the
 * generator. Running `npx create-nextly-app` inside a pnpm app otherwise ran
 * `npm install` over pnpm's `node_modules`, and npm crashed.
 *
 * With no lockfile — a fresh scaffold's empty target directory, the common
 * case — the user agent decides, which every manager sets when it runs a
 * `create-*` command, so "next steps" names the manager the person used.
 * npm is the last resort, for the bin run directly with `node`.
 */
export async function detectPackageManager(
  cwd: string
): Promise<PackageManager> {
  return (await lockfileManager(cwd)) ?? launcher();
}

/**
 * The package manager of an app that already exists, which may be one member
 * of a workspace: its own lockfile first, then the lockfile of the workspace
 * that lists it (see {@link findWorkspaceRoot}), then the launcher. A member
 * has no lockfile of its own, and falling back to the launcher there ran
 * `npm install` inside a pnpm workspace.
 */
export async function detectAppPackageManager(
  cwd: string
): Promise<PackageManager> {
  return (
    (await lockfileManager(cwd)) ??
    (await findWorkspaceRoot(cwd))?.manager ??
    launcher()
  );
}

const launcher = (): PackageManager =>
  detectPmFromUserAgent(process.env.npm_config_user_agent) ?? "npm";

/**
 * Detect project configuration and validate Next.js setup.
 *
 * `chosen` is a manager already settled: a new project's comes from the
 * command that launched the scaffold, before any file was written. Reading
 * the written files would answer differently, since every scaffold writes
 * `pnpm-workspace.yaml` for its build allowlist, whatever installs it.
 */
export async function detectProject(
  cwd: string,
  chosen?: PackageManager
): Promise<ProjectInfo> {
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
  const packageManager = chosen ?? (await detectAppPackageManager(cwd));

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

/**
 * Describe a freshly scaffolded plugin package.
 *
 * A plugin is a publishable library: its code lives in src/ and its Next.js
 * playground in dev/, so {@link detectProject} rejects it ("App Router not
 * detected") although that is exactly the layout the template ships. Nothing
 * about the layout needs detecting; only the package manager does, and it is
 * the one field a fresh scaffold's install and next steps read.
 */
export async function detectPluginPackage(
  cwd: string,
  chosen?: PackageManager
): Promise<ProjectInfo> {
  return {
    isNextJs: false,
    isAppRouter: false,
    hasTypescript: true,
    packageManager: chosen ?? (await detectPackageManager(cwd)),
    nextVersion: null,
    srcDir: true,
    appDir: "dev/src/app",
  };
}
