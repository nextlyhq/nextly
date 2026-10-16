import path from "path";

import fs from "fs-extra";
import picomatch from "picomatch";
import { parse } from "yaml";

import type { PackageManager } from "../types";

/**
 * Lockfiles, and the manager each one belongs to. Bun writes the text
 * `bun.lock` by default since 1.2; `bun.lockb` is the older binary form.
 */
const LOCKFILES: ReadonlyArray<readonly [string, PackageManager]> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
  ["npm-shrinkwrap.json", "npm"],
];

/** The manager whose lockfile is in `dir`, if one is. */
export async function lockfileManager(
  dir: string
): Promise<PackageManager | undefined> {
  for (const [lockfile, manager] of LOCKFILES) {
    if (await fs.pathExists(path.join(dir, lockfile))) return manager;
  }
  return undefined;
}

export interface WorkspaceRoot {
  dir: string;
  /** From the root's lockfile, or pnpm for a pnpm workspace not installed yet. */
  manager: PackageManager | undefined;
}

/**
 * The workspace `appDir` is a member of: the nearest directory above it whose
 * `pnpm-workspace.yaml` `packages`, or `package.json` `workspaces`, lists it.
 *
 * Membership is what makes a directory the app's workspace root. A lockfile
 * or workspace file above an app that no workspace lists says nothing about
 * the app: it may sit inside an unrelated project, and taking that project's
 * manager installs it with the wrong one. A `pnpm-workspace.yaml` with no
 * `packages` (the build allowlist a scaffold writes, say) lists nothing.
 *
 * The walk stops at the repository's root (the directory holding `.git`), so
 * a workspace somewhere above the repository is never taken for the app's.
 */
export async function findWorkspaceRoot(
  appDir: string
): Promise<WorkspaceRoot | undefined> {
  const app = path.resolve(appDir);
  let dir = app;
  while (!(await fs.pathExists(path.join(dir, ".git")))) {
    const parent = path.dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
    const relative = path.relative(dir, app).split(path.sep).join("/");
    const listed = await workspaceListing(dir);
    if (listed && listsMember(listed.globs, relative)) {
      return {
        dir,
        manager:
          (await lockfileManager(dir)) ?? (listed.pnpm ? "pnpm" : undefined),
      };
    }
  }
  return undefined;
}

/** The member globs `dir` declares, and whether pnpm's file declares them. */
async function workspaceListing(
  dir: string
): Promise<{ globs: string[]; pnpm: boolean } | undefined> {
  const pnpmFile = path.join(dir, "pnpm-workspace.yaml");
  if (await fs.pathExists(pnpmFile)) {
    const globs = stringsAt(
      readYaml(await fs.readFile(pnpmFile, "utf-8")),
      "packages"
    );
    if (globs) return { globs, pnpm: true };
  }
  const pkgFile = path.join(dir, "package.json");
  if (await fs.pathExists(pkgFile)) {
    const pkg: unknown = await fs.readJson(pkgFile).catch(() => undefined);
    const workspaces = isObject(pkg) ? pkg.workspaces : undefined;
    // npm, Bun and Yarn take an array; Yarn 1 also takes `{ packages: [...] }`.
    const globs = Array.isArray(workspaces)
      ? strings(workspaces)
      : stringsAt(workspaces, "packages");
    if (globs) return { globs, pnpm: false };
  }
  return undefined;
}

function readYaml(text: string): unknown {
  try {
    return parse(text);
  } catch {
    // A file pnpm itself could not read declares nothing this can rely on.
    return undefined;
  }
}

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const strings = (value: unknown[]): string[] =>
  value.filter((item): item is string => typeof item === "string");

function stringsAt(value: unknown, key: string): string[] | undefined {
  const list = isObject(value) ? value[key] : undefined;
  return Array.isArray(list) ? strings(list) : undefined;
}

/**
 * Whether the member globs include `relative`: one positive glob matches it
 * and no `!` glob does, as pnpm reads them whatever their order.
 *
 * Matched with picomatch, the matcher under the globbing pnpm and Yarn use,
 * so braces, character classes and extglobs list an app as the package
 * manager reads them; a hand-written subset took those for literals.
 */
function listsMember(globs: readonly string[], relative: string): boolean {
  const matches = (glob: string) =>
    picomatch(glob.replace(/^\.\//, "").replace(/\/+$/, ""))(relative);
  return (
    globs.some(glob => !glob.startsWith("!") && matches(glob)) &&
    !globs.some(glob => glob.startsWith("!") && matches(glob.slice(1)))
  );
}
