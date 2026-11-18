/**
 * The Nextly packages of a project: what its `package.json` declares, and
 * what is installed.
 *
 * Nextly's packages version together, so `nextly` and every `@nextlyhq/*`
 * package a project depends on move as one. A package declared by anything
 * other than a version or range of the registry (a workspace link, a folder,
 * a git address) is one the registry cannot move.
 *
 * @module cli/commands/upgrade-packages/project-packages
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import semver from "semver";

/** The sections of `package.json` a project declares what it installs in. */
const SECTIONS = [
  "dependencies",
  "devDependencies",
  "optionalDependencies",
] as const;
type Section = (typeof SECTIONS)[number];

/** One Nextly package as `package.json` declares it. */
export interface DeclaredPackage {
  name: string;
  section: Section;
  /** What the section says for it: `0.0.2-alpha.70`, `^0.0.2-alpha.70`, `workspace:*`. */
  spec: string;
  /** Whether the spec is a version or range the registry answers. */
  fromRegistry: boolean;
}

/** Whether a package is one of Nextly's, which version together. */
export function isNextlyPackage(name: string): boolean {
  return name === "nextly" || name.startsWith("@nextlyhq/");
}

type Manifest = Partial<Record<Section, Record<string, string>>>;

/** `package.json` as text and parsed, or undefined where the folder has none it can read. */
export function readManifest(
  projectDir: string
): { text: string; manifest: Manifest } | undefined {
  try {
    const text = readFileSync(join(projectDir, "package.json"), "utf8");
    return { text, manifest: JSON.parse(text) as Manifest };
  } catch {
    return undefined;
  }
}

/** Every Nextly package `manifest` declares, in the order it declares them. */
export function declaredNextlyPackages(manifest: Manifest): DeclaredPackage[] {
  return SECTIONS.flatMap(section =>
    Object.entries(manifest[section] ?? {})
      .filter(([name]) => isNextlyPackage(name))
      .map(([name, spec]) => ({
        name,
        section,
        spec,
        fromRegistry: semver.validRange(spec) !== null,
      }))
  );
}

/**
 * `text` with every package of `packages` declared at exactly `version`, in
 * the section and place it has, and everything else as it was: the
 * indentation and the final newline included. One exact version for all, as
 * the scaffold writes them: a range over a prerelease is satisfied by every
 * later prerelease, so it would not hold the packages together.
 */
export function withVersions(
  text: string,
  packages: readonly DeclaredPackage[],
  version: string
): string {
  const manifest = JSON.parse(text) as Manifest;
  for (const { name, section } of packages) {
    const entries = manifest[section];
    if (entries !== undefined) entries[name] = version;
  }
  const indent = /^[ \t]+(?=")/m.exec(text)?.[0] ?? "  ";
  return `${JSON.stringify(manifest, null, indent)}${text.endsWith("\n") ? "\n" : ""}`;
}

/**
 * The version of `name` installed for the project, read from the
 * `node_modules` folder Node would find it in, starting at the project and
 * going up; undefined where it is not installed. Read from the file rather
 * than resolved, since a package need not let its `package.json` be
 * imported.
 */
export function installedVersion(
  projectDir: string,
  name: string
): string | undefined {
  let dir = projectDir;
  for (;;) {
    const file = join(dir, "node_modules", name, "package.json");
    if (existsSync(file)) {
      try {
        const version = (
          JSON.parse(readFileSync(file, "utf8")) as {
            version?: unknown;
          }
        ).version;
        return typeof version === "string" ? version : undefined;
      } catch {
        return undefined;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) return undefined;
    dir = parent;
  }
}
