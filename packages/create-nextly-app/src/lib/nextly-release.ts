import path from "path";

import fs from "fs-extra";

import type { PackageManager } from "../types";

import { EXACT_VERSION } from "./exact-version";

/**
 * Where a project's Nextly packages come from.
 *
 * Nextly's packages version in lockstep, so this CLI's own version names the
 * release of every one of them, and everything the CLI writes (the templates,
 * the agent guide, the skills) was made for that release. On the default
 * paths a project therefore gets exactly that release (`release`), declared
 * as one exact version: a caret range over a prerelease, `^0.0.2-alpha.66`,
 * is satisfied by every later `0.0.2` prerelease, so it would not hold the
 * release the files were written for.
 *
 * A source given on purpose takes what was asked for. `--use-yalc` links
 * local builds (`yalc`); a template from a disk or a branch tracks the active
 * release line, the `alpha` dist-tag, more closely than any one release
 * (`alpha`). npm's `latest` tag has no part in any of them.
 */
export interface NextlySource {
  kind: "release" | "alpha" | "yalc";
  /** This CLI's version: the release a `release` source installs. */
  cliVersion: string;
}

export function nextlySource(options: {
  cliVersion: string;
  useYalc?: boolean;
  localTemplatePath?: string;
  branch?: string;
}): NextlySource {
  const { cliVersion } = options;
  if (options.useYalc) return { kind: "yalc", cliVersion };
  if (options.localTemplatePath !== undefined || options.branch !== undefined) {
    return { kind: "alpha", cliVersion };
  }
  // A build whose version names no one release (never one this CLI is
  // published as) has no release to install.
  if (!EXACT_VERSION.test(cliVersion)) return { kind: "alpha", cliVersion };
  return { kind: "release", cliVersion };
}

/** Whether a package is one of Nextly's, which version together. */
export function isNextlyPackage(name: string): boolean {
  return name === "nextly" || name.startsWith("@nextlyhq/");
}

/** A Nextly package an existing app already has at something other than the release. */
export interface NextlyVersionConflict {
  name: string;
  installed?: string;
  declared?: string;
}

const DEPENDENCY_FIELDS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
  "peerDependencies",
] as const;

/**
 * The Nextly packages an existing app has, installed or declared, that are
 * not exactly `version`. One of `adding` the app neither has installed nor
 * declares is not a conflict: it is added at `version`. A declared range or
 * tag names no one release, so it conflicts even where the version installed
 * is `version`: the app would declare one thing and the CLI install another.
 *
 * What is installed is what the app would load: its own `node_modules`, or a
 * folder above it where a workspace hoists its dependencies. Where there is
 * none to read (an app not installed yet, or Yarn's Plug'n'Play), only the
 * declaration is judged.
 */
export async function nextlyVersionConflicts(
  cwd: string,
  version: string,
  adding: readonly string[]
): Promise<NextlyVersionConflict[]> {
  const declared = await declaredNextlyPackages(cwd);
  const names = [
    ...new Set([...adding.filter(isNextlyPackage), ...declared.keys()]),
  ];
  const conflicts: NextlyVersionConflict[] = [];
  for (const name of names) {
    const installed = await installedVersion(cwd, name);
    const specs = declared.get(name) ?? [];
    // The declaration to name: one that is not the release, if any is.
    const spec = specs.find(found => found !== version) ?? specs[0];
    if (
      (installed !== undefined && installed !== version) ||
      (spec !== undefined && spec !== version)
    ) {
      conflicts.push({ name, installed, declared: spec });
    }
  }
  return conflicts;
}

/**
 * Every declaration the app's package.json makes of each Nextly package, in
 * field order. All of them count, not only the first: npm installs an
 * `optionalDependencies` entry over a `dependencies` one of the same name.
 */
async function declaredNextlyPackages(
  cwd: string
): Promise<Map<string, string[]>> {
  const manifest = (await fs
    .readJson(path.join(cwd, "package.json"))
    .catch(() => ({}))) as Record<string, unknown>;
  const declared = new Map<string, string[]>();
  for (const field of DEPENDENCY_FIELDS) {
    const deps = manifest[field];
    if (!deps || typeof deps !== "object") continue;
    for (const [name, spec] of Object.entries(deps)) {
      if (isNextlyPackage(name) && typeof spec === "string") {
        declared.set(name, [...(declared.get(name) ?? []), spec]);
      }
    }
  }
  return declared;
}

/**
 * The version of `name` Node.js would load from `from`: the first
 * `node_modules/<name>` in it or a folder above, as a workspace that hoists
 * its dependencies puts it. Undefined when there is none, as under Yarn
 * Plug'n'Play, which keeps no such folder.
 */
export async function installedVersion(
  from: string,
  name: string
): Promise<string | undefined> {
  let folder = path.resolve(from);
  for (;;) {
    const manifest = (await fs
      .readJson(
        path.join(folder, "node_modules", ...name.split("/"), "package.json")
      )
      .catch(() => undefined)) as { version?: unknown } | undefined;
    if (typeof manifest?.version === "string") return manifest.version;
    const parent = path.dirname(folder);
    if (parent === folder) return undefined;
    folder = parent;
  }
}

/**
 * The flag that makes each package manager record a version exactly as given:
 * npm records `nextly@X` as `^X` without it.
 */
export const EXACT_FLAG: Record<PackageManager, string> = {
  npm: "--save-exact",
  pnpm: "--save-exact",
  yarn: "--exact",
  bun: "--exact",
};

const ADD_COMMAND: Record<PackageManager, string> = {
  npm: "npm install",
  pnpm: "pnpm add",
  yarn: "yarn add",
  bun: "bun add",
};

/**
 * Why the run stopped, and the one way on: every Nextly package the app has
 * set to exactly `version`, then the CLI again. An earlier CLI is not offered:
 * one made before it pinned its own release installs from `latest`, without
 * this check, so it would neither keep the app's version nor stop first.
 */
export function nextlyVersionConflictMessage(
  conflicts: readonly NextlyVersionConflict[],
  version: string,
  pm: PackageManager
): string {
  const lines = conflicts.map(({ name, installed, declared }) => {
    const parts = [
      installed !== undefined ? `installed ${installed}` : undefined,
      declared !== undefined ? `declared ${declared}` : undefined,
    ].filter(Boolean);
    return `  ${name}: ${parts.join(", ")}`;
  });
  const set = conflicts.map(({ name }) => `${name}@${version}`).join(" ");
  return (
    `This app has Nextly packages at a version other than this create-nextly-app's, ${version}:\n` +
    `${lines.join("\n")}\n\n` +
    `Nothing was changed. Set every Nextly package the app has to exactly ${version}, then run create-nextly-app again:\n` +
    `  ${ADD_COMMAND[pm]} ${EXACT_FLAG[pm]} ${set}`
  );
}
