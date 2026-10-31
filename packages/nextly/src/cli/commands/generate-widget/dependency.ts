/**
 * The package the generated test and component import from,
 * `@nextlyhq/plugin-sdk`, and how the project installs it.
 *
 * A plugin already depends on it, but a site from the blank template does not,
 * so a site that lacks it gets it added to its package.json devDependencies at
 * the running nextly's version, and is told to install.
 *
 * @module cli/commands/generate-widget/dependency
 */
import type { FileEdit } from "./config-edit";

const SDK_PACKAGE = "@nextlyhq/plugin-sdk";

/** Every section of a manifest a package can already be declared in. */
const SECTIONS = [
  "dependencies",
  "devDependencies",
  "peerDependencies",
  "optionalDependencies",
] as const;

type Manifest = Record<string, unknown>;

const isRecord = (value: unknown): value is Manifest =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A package.json's object, or nothing when it is not one. */
function manifestOf(text: string): Manifest | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** The indentation a JSON text is written with: its first indented line's. */
const indentOf = (text: string): string =>
  /^([ \t]+)"/m.exec(text)?.[1] ?? "  ";

type SdkDependency =
  | { kind: "present" }
  | { kind: "edit"; edit: FileEdit }
  | { kind: "manual"; instructions: string };

/**
 * Whether the manifest at `path` (its `text`, `undefined` when there is none)
 * declares the SDK; when not, the edit adding it to devDependencies at
 * `version`, keeping the file's indentation and key order; and what to do by
 * hand when the manifest is missing or cannot be read as one.
 *
 * `version` is exact: the family versions in lockstep, so the SDK that goes
 * with the running nextly is the same release, as a new project pins them.
 */
export function sdkDependency(
  path: string,
  text: string | undefined,
  version: string
): SdkDependency {
  const manifest = text === undefined ? undefined : manifestOf(text);
  const dev = manifest?.devDependencies ?? {};
  if (text === undefined || manifest === undefined || !isRecord(dev)) {
    return {
      kind: "manual",
      instructions: `Add ${SDK_PACKAGE}@${version} to your devDependencies: the generated test imports it.`,
    };
  }
  const declared = SECTIONS.some(section => {
    const deps = manifest[section];
    return isRecord(deps) && SDK_PACKAGE in deps;
  });
  if (declared) return { kind: "present" };
  const updated = {
    ...manifest,
    devDependencies: { ...dev, [SDK_PACKAGE]: version },
  };
  const after = `${JSON.stringify(updated, null, indentOf(text))}${text.endsWith("\n") ? "\n" : ""}`;
  return { kind: "edit", edit: { path, before: text, after } };
}

export type PackageManager = "npm" | "pnpm" | "yarn" | "bun";

/** Each lockfile, and the package manager that writes it. */
export const LOCKFILES: readonly (readonly [string, PackageManager])[] = [
  ["pnpm-lock.yaml", "pnpm"],
  ["yarn.lock", "yarn"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["package-lock.json", "npm"],
];

/** How each package manager adds a development dependency. */
export const ADD_DEV: Record<PackageManager, string> = {
  npm: "npm install --save-dev",
  pnpm: "pnpm add -D",
  yarn: "yarn add -D",
  bun: "bun add --dev",
};
