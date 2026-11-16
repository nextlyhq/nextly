import path from "path";

import fs from "fs-extra";

import { PACKAGE_MANAGERS } from "../lib/choices";
import type { PackageManager, ProjectInfo } from "../types";

import { detectPmFromUserAgent } from "./detect-pm-from-user-agent";
import {
  findWorkspaceRoot,
  lockfileManager,
  lockfileManagers,
} from "./workspace";

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
  return (await installedAppPackageManager(cwd)) ?? launcher();
}

/**
 * The manager an existing app was installed with, from its own lockfile or
 * its workspace's; undefined when it has none, where the launcher decides.
 */
async function installedAppPackageManager(
  cwd: string
): Promise<PackageManager | undefined> {
  return (
    (await lockfileManager(cwd)) ?? (await findWorkspaceRoot(cwd))?.manager
  );
}

/** One thing that says which manager a project is set up for. */
export interface PackageManagerSignal {
  manager: PackageManager;
  /** Where it was read, for a message: "its lockfile", "its workspace's package.json". */
  what: string;
}

/**
 * Everything that says which manager the project at `appDir` is set up for,
 * each on its own: every lockfile in it and in the workspace that lists it,
 * and the `packageManager`/`devEngines` declarations of both, which Corepack
 * enforces. `appDir` need not exist yet, so a new member of a workspace gets
 * its workspace's signals. Agreeing signals name one manager; any other is
 * the mix a second manager would add to.
 */
export async function packageManagerSignals(
  appDir: string
): Promise<PackageManagerSignal[]> {
  const workspace = await findWorkspaceRoot(appDir);
  const rootLockfiles = workspace ? await lockfileManagers(workspace.dir) : [];
  const rootDeclared = workspace
    ? await declaredAppPackageManager(workspace.dir)
    : undefined;
  const signals: Array<{ manager: PackageManager | undefined; what: string }> =
    [
      ...(await lockfileManagers(appDir)).map(manager => ({
        manager,
        what: "its lockfile",
      })),
      {
        manager: await declaredAppPackageManager(appDir),
        what: "its package.json",
      },
      ...rootLockfiles.map(manager => ({
        manager,
        what: "its workspace's lockfile",
      })),
      // A pnpm workspace not installed yet names pnpm by its workspace file.
      {
        manager: rootLockfiles.length === 0 ? workspace?.manager : undefined,
        what: "its workspace",
      },
      { manager: rootDeclared, what: "its workspace's package.json" },
    ];
  return signals.filter(
    (signal): signal is PackageManagerSignal => signal.manager !== undefined
  );
}

/**
 * The manager an existing app's package.json declares, by `packageManager`
 * or by `devEngines.packageManager`, which Corepack enforces: installing with
 * another fails part-way. Undefined when it declares none.
 */
async function declaredAppPackageManager(
  cwd: string
): Promise<PackageManager | undefined> {
  let manifest: {
    packageManager?: unknown;
    devEngines?: { packageManager?: unknown };
  };
  try {
    manifest = await fs.readJson(path.join(cwd, "package.json"));
  } catch {
    return undefined;
  }
  const declared = manifest.devEngines?.packageManager;
  const name =
    typeof manifest.packageManager === "string"
      ? manifest.packageManager.split("@")[0]
      : (
          (Array.isArray(declared) ? declared[0] : declared) as
            | { name?: unknown }
            | undefined
        )?.name;
  return PACKAGE_MANAGERS.find(manager => manager === name);
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
