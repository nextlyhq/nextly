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
  /** Set once Yarn has been asked which it is. */
  yarn?: YarnKind;
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

/** Which Yarn a project runs: Yarn 1 takes other words than the releases after it. */
export interface YarnKind {
  classic?: boolean;
}

/** Whether what `yarn --version` printed names Yarn 1. */
export function isYarnClassic(version: string): boolean {
  return version.trim().startsWith("1.");
}

/**
 * The arguments of the install run once `package.json` names the new
 * versions. A manager that refuses to change a lockfile where it sees a CI
 * environment is told it may: changing it is what was asked for. Yarn 1
 * changes its lockfile unless told not to, and refuses a flag it does not
 * know.
 */
export function installArgs(
  manager: PackageManager,
  yarn: YarnKind = {}
): string[] {
  switch (manager) {
    case "pnpm":
      return ["install", "--no-frozen-lockfile"];
    case "yarn":
      return yarn.classic === true
        ? ["install"]
        : ["install", "--no-immutable"];
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
export function viewArgs(
  manager: PackageManager,
  name: string,
  yarn: YarnKind = {}
): string[] {
  switch (manager) {
    case "yarn":
      return yarn.classic === true
        ? ["info", name, "--json"]
        : ["npm", "info", name, "--fields", "dist-tags,versions", "--json"];
    case "bun":
      return ["pm", "view", name, "--json"];
    default:
      return ["view", name, "dist-tags", "versions", "--json"];
  }
}

export interface ManagerRun {
  /** The exit status, or null where the manager could not be started or was stopped. */
  status: number | null;
  /** What it printed on standard output, up to `STDOUT_LIMIT`. */
  stdout: string;
  /** The end of everything it printed, both streams, for a failure's report. */
  output: string;
}

/** How much of a run's output is kept for a report: its end. */
const OUTPUT_TAIL = 64 * 1024;
/** How much standard output is kept: a registry's whole answer for a package, with room. */
const STDOUT_LIMIT = 16 * 1024 * 1024;

/**
 * Runs `manager <args>` in `cwd` and waits for it to end, keeping the end of
 * what it printed. Stopped through `signal`, the child is ended and its end
 * is still waited for, so nothing it was doing goes on after this returns.
 */
export function runManager(
  manager: PackageManager,
  args: readonly string[],
  cwd: string,
  options: { signal?: AbortSignal } = {}
): Promise<ManagerRun> {
  return new Promise(settle => {
    // Through a shell on Windows, where each manager is a `.cmd` shim.
    // It is given no input: a manager or a script waiting for some reads
    // the end of it at once, rather than waiting on a run nobody can answer.
    const child = spawn(manager, args, {
      cwd,
      shell: process.platform === "win32",
      stdio: ["ignore", "pipe", "pipe"],
      // In a process group of its own where there are such, so that stopping
      // it stops the scripts and downloads it started with it.
      detached: process.platform !== "win32",
    });
    let stdout = "";
    let output = "";
    const keep = (chunk: string) => {
      output = (output + chunk).slice(-OUTPUT_TAIL);
    };
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      if (stdout.length < STDOUT_LIMIT) stdout += chunk;
      keep(chunk);
    });
    child.stderr.setEncoding("utf8").on("data", keep);
    const stop = () => {
      try {
        // The whole group: the manager and everything it started.
        if (process.platform !== "win32" && child.pid !== undefined) {
          process.kill(-child.pid, "SIGTERM");
          return;
        }
      } catch {
        // The group is gone already; the child itself is asked below.
      }
      child.kill("SIGTERM");
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    child.on("error", error => {
      keep(`${manager} could not be started: ${error.message}`);
      // A child that never started has no end to wait for.
      if (child.pid === undefined) settle({ status: null, stdout, output });
    });
    child.on("close", status => {
      options.signal?.removeEventListener("abort", stop);
      settle({ status, stdout, output });
    });
  });
}

/** Which Yarn `cwd` runs, asked of Yarn itself. */
export async function yarnKindIn(cwd: string): Promise<YarnKind> {
  const run = await runManager("yarn", ["--version"], cwd);
  return { classic: run.status === 0 && isYarnClassic(run.stdout) };
}
