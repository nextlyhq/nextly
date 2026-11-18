/**
 * The package manager a project is installed with, and how `nextly upgrade`
 * asks it for the three things it needs: what a registry holds for a
 * package, an install after `package.json` changed, and an install that puts
 * back what the lockfile records.
 *
 * Detected as the scaffold detects it: the project's own lockfile first,
 * then its `packageManager` field, then the same two in each folder above it
 * (a workspace keeps one lockfile at its root), and npm where nothing says.
 *
 * @module cli/commands/upgrade-packages/package-manager
 */

import { spawn } from "node:child_process";
import { existsSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Each lockfile and the manager that keeps it. */
const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

const MANAGERS: readonly string[] = ["npm", "pnpm", "yarn", "bun"];

export interface DetectedManager {
  manager: PackageManager;
  /** The lockfile the install rewrites, where the project has one. */
  lockfile: string | undefined;
  /** Where the lockfile is, or would be: the folder the manager installs from. */
  root: string;
}

/** The manager `dir`'s `package.json` declares in `packageManager`, if it names one. */
function declaredManager(dir: string): PackageManager | undefined {
  try {
    const manifest = JSON.parse(
      readFileSync(join(dir, "package.json"), "utf8")
    ) as { packageManager?: unknown };
    const name =
      typeof manifest.packageManager === "string"
        ? manifest.packageManager.split("@")[0]
        : undefined;
    return name !== undefined && MANAGERS.includes(name)
      ? (name as PackageManager)
      : undefined;
  } catch {
    return undefined;
  }
}

/** What `dir` itself says of its manager: a lockfile, or a declaration. */
function managerIn(dir: string): PackageManager | undefined {
  for (const [file, manager] of LOCKFILES) {
    if (existsSync(join(dir, file))) return manager;
  }
  return declaredManager(dir);
}

/**
 * `dir` and each folder above it, up to the one holding the repository
 * (`.git`), or to the top where there is none: where a workspace's root is,
 * and no further, so a lockfile left in a home folder is never taken for
 * the project's.
 */
function upToRepository(dir: string): string[] {
  const folders: string[] = [];
  for (let at = dir; ; at = dirname(at)) {
    folders.push(at);
    if (existsSync(join(at, ".git")) || dirname(at) === at) return folders;
  }
}

/**
 * The manager of the project in `projectDir`, and the lockfile its install
 * rewrites: the nearest one that manager keeps, which in a workspace is the
 * root's whatever the project's own `package.json` declares.
 */
export function detectPackageManager(projectDir: string): DetectedManager {
  const folders = upToRepository(projectDir);
  const decided = folders.find(dir => managerIn(dir) !== undefined);
  const manager = (decided && managerIn(decided)) ?? "npm";
  const holder = folders.find(dir => lockfileOf(manager, dir) !== undefined);
  return {
    manager,
    lockfile: holder === undefined ? undefined : lockfileOf(manager, holder),
    root: holder ?? decided ?? projectDir,
  };
}

/** The lockfile `manager` keeps in `root` now, whichever spelling it uses. */
export function lockfileOf(
  manager: PackageManager,
  root: string
): string | undefined {
  return LOCKFILES.filter(([, keeper]) => keeper === manager)
    .map(([file]) => join(root, file))
    .find(file => existsSync(file));
}

/** Whether the project is installed with Yarn's Plug'n'Play, which keeps no `node_modules`. */
export function usesPlugAndPlay(root: string): boolean {
  return (
    existsSync(join(root, ".pnp.cjs")) || existsSync(join(root, ".pnp.js"))
  );
}

/**
 * The arguments of the install run once `package.json` names the new
 * versions. A manager that refuses to change a lockfile where it sees a CI
 * environment is told it may: changing it is what was asked for.
 */
export function installArgs(manager: PackageManager): string[] {
  switch (manager) {
    case "pnpm":
      return ["install", "--no-frozen-lockfile"];
    case "yarn":
      return ["install", "--no-immutable"];
    default:
      return ["install"];
  }
}

/**
 * Makes `manager` install again from the lockfile, in full, where it would
 * otherwise take the folder for up to date. pnpm records what it last linked
 * in `node_modules/.modules.yaml` and `node_modules/.pnpm/lock.yaml`; an
 * install that failed part-way has unlinked packages and left both records
 * as they were, so an install from the same lockfile finds nothing to do.
 * Without the records it links everything the lockfile names, from its
 * store.
 */
export function forgetInstallState(
  manager: PackageManager,
  root: string
): void {
  if (manager !== "pnpm") return;
  for (const record of [".modules.yaml", join(".pnpm", "lock.yaml")]) {
    rmSync(join(root, "node_modules", record), { force: true });
  }
}

/** The arguments asking `manager` what the registry holds for `name`, as JSON. */
export function viewArgs(manager: PackageManager, name: string): string[] {
  switch (manager) {
    case "yarn":
      return ["npm", "info", name, "--fields", "dist-tags,versions", "--json"];
    case "bun":
      return ["pm", "view", name, "--json"];
    default:
      return ["view", name, "dist-tags", "versions", "--json"];
  }
}

export interface ManagerRun {
  /** The exit status, or null where the manager could not be started or was stopped. */
  status: number | null;
  stdout: string;
  /** Everything it printed, both streams, for a failure's report. */
  output: string;
}

/** Runs `manager <args>` in `cwd` and waits for it, keeping what it printed. */
export function runManager(
  manager: PackageManager,
  args: readonly string[],
  cwd: string
): Promise<ManagerRun> {
  return new Promise(settle => {
    // Through a shell on Windows, where each manager is a `.cmd` shim.
    // It is given no input: a manager or a script waiting for some reads
    // the end of it at once, rather than waiting on a run nobody can answer.
    const child = spawn(manager, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let output = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
      output += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      output += chunk;
    });
    child.on("error", error => {
      output += `${manager} could not be started: ${error.message}`;
      settle({ status: null, stdout, output });
    });
    child.on("close", status => settle({ status, stdout, output }));
  });
}
