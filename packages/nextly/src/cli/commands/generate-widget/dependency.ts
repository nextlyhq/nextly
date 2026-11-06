/**
 * The packages the generated test needs from the project, and how the project
 * installs them.
 *
 * The test and a component import `@nextlyhq/plugin-sdk`, and the test boots
 * an in-memory SQLite instance, which loads `@nextlyhq/adapter-sqlite`. A
 * plugin has both, but a site from the blank template has no SDK, and a site
 * on PostgreSQL or MySQL has only its own adapter. Whatever the project lacks
 * is added to its package.json devDependencies at the running nextly's
 * version, and the author is told to install.
 *
 * @module cli/commands/generate-widget/dependency
 */
import type { FileEdit } from "./config-edit";

/** What the generated test needs installed: the SDK it imports, and the adapter it boots on. */
const TEST_PACKAGES = ["@nextlyhq/plugin-sdk", "@nextlyhq/adapter-sqlite"];

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

type TestDependencies =
  | { kind: "present" }
  | { kind: "edit"; edit: FileEdit; added: string[] }
  | { kind: "manual"; instructions: string };

/** Whether `manifest` declares `name` in any section. */
const declares = (manifest: Manifest, name: string): boolean =>
  SECTIONS.some(section => {
    const deps = manifest[section];
    return isRecord(deps) && name in deps;
  });

/**
 * Whether the manifest at `path` (its `text`, `undefined` when there is none)
 * declares every package the test needs; when not, the edit adding the missing
 * ones to devDependencies at `version`, keeping the file's indentation and key
 * order; and what to do by hand when the manifest is missing or cannot be read
 * as one.
 *
 * `version` is exact: the family versions in lockstep, so the packages that go
 * with the running nextly are the same release, as a new project pins them.
 */
export function testDependencies(
  path: string,
  text: string | undefined,
  version: string
): TestDependencies {
  const manifest = text === undefined ? undefined : manifestOf(text);
  const dev = manifest?.devDependencies ?? {};
  if (text === undefined || manifest === undefined || !isRecord(dev)) {
    const wanted = TEST_PACKAGES.map(name => `${name}@${version}`).join(
      " and "
    );
    return {
      kind: "manual",
      instructions: `Add ${wanted} to your devDependencies: the generated test needs them.`,
    };
  }
  const added = TEST_PACKAGES.filter(name => !declares(manifest, name));
  if (added.length === 0) return { kind: "present" };
  const updated = {
    ...manifest,
    devDependencies: {
      ...dev,
      ...Object.fromEntries(added.map(name => [name, version])),
    },
  };
  const after = `${JSON.stringify(updated, null, indentOf(text))}${text.endsWith("\n") ? "\n" : ""}`;
  return { kind: "edit", edit: { path, before: text, after }, added };
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
