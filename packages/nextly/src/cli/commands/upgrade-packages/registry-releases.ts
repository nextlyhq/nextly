/**
 * What the registry holds for a package: its dist-tags and its versions.
 *
 * Asked through the project's own package manager, so the registry, the
 * scopes and the credentials the project is configured with are the ones
 * used. Where the manager cannot answer (one with no such command), the
 * registry the project's `.npmrc` names is asked directly.
 *
 * @module cli/commands/upgrade-packages/registry-releases
 */

import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { z } from "zod";

import {
  runManager,
  viewArgs,
  type PackageManager,
  type YarnKind,
} from "./package-manager";
import type { RegistryReleases } from "./release-choice";

export type RegistryAnswer =
  | { kind: "found"; releases: RegistryReleases }
  /** The registry was reached and has no such package. */
  | { kind: "missing" }
  /** The registry could not be asked; `why` is what was said. */
  | { kind: "unreadable"; why: string };

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/**
 * A package document as a registry or a manager's view gives one: the tags,
 * each naming a version, and the versions as a list (a view), one name (a
 * view of a package with one version) or a map by version (the registry's
 * own document).
 */
const documentSchema = z.object({
  "dist-tags": z.record(z.string(), z.string()),
  versions: z.union([
    z.array(z.string()),
    z.string().transform(version => [version]),
    z
      .record(z.string(), z.unknown())
      .transform(byVersion => Object.keys(byVersion)),
  ]),
});

/** The document itself, or wrapped as Yarn 1 prints it: `{ type, data }`. */
const answerSchema = z.union([
  documentSchema,
  z.object({ data: documentSchema }).transform(wrapped => wrapped.data),
]);

/**
 * The tags and versions in a registry's answer, or undefined where it is not
 * one: a document naming no version says nothing of what is published.
 */
export function parseReleases(answer: unknown): RegistryReleases | undefined {
  const read = answerSchema.safeParse(answer);
  if (!read.success || read.data.versions.length === 0) return undefined;
  return { tags: read.data["dist-tags"], versions: read.data.versions };
}

/** `text` parsed as JSON, or undefined where it is not. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** The settings an `.npmrc` in `dir` gives, by key; none where it has no such file. */
function npmrcIn(dir: string): Map<string, string> {
  const file = join(dir, ".npmrc");
  if (!existsSync(file)) return new Map();
  return new Map(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map(line => line.split("=").map(part => part.trim()))
      .filter(([key, value]) => Boolean(key) && Boolean(value))
      .map(([key = "", value = ""]) => [key, value])
  );
}

/** `dir` and every folder above it, nearest first. */
function foldersUp(dir: string): string[] {
  const parent = dirname(dir);
  return parent === dir ? [dir] : [dir, ...foldersUp(parent)];
}

/**
 * The registry the project's `.npmrc` names for `name`, from the project
 * folder upwards: its scope's own registry first, then the default one, each
 * from the nearest file that sets it.
 */
export function registryFor(projectDir: string, name: string): string {
  const settings = foldersUp(projectDir).map(npmrcIn);
  const nearest = (key: string) =>
    settings.find(file => file.has(key))?.get(key);
  const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
  const scoped = scope === undefined ? undefined : nearest(`${scope}:registry`);
  return scoped ?? nearest("registry") ?? DEFAULT_REGISTRY;
}

/** The package's document, asked of the registry itself. */
async function askRegistry(
  projectDir: string,
  name: string
): Promise<RegistryAnswer> {
  const registry = registryFor(projectDir, name).replace(/\/+$/, "");
  try {
    const response = await fetch(`${registry}/${name.replace("/", "%2f")}`, {
      headers: { accept: "application/json" },
    });
    if (response.status === 404) return { kind: "missing" };
    const releases = response.ok
      ? parseReleases(await response.json())
      : undefined;
    return releases === undefined
      ? {
          kind: "unreadable",
          why: `${registry} answered ${String(response.status)} for ${name}`,
        }
      : { kind: "found", releases };
  } catch (error) {
    return {
      kind: "unreadable",
      why: `${registry} could not be reached: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
}

/** What the registry holds for `name`, as the project's manager reads it. */
export async function releasesOf(
  manager: PackageManager,
  projectDir: string,
  name: string,
  yarn: YarnKind = {}
): Promise<RegistryAnswer> {
  const run = await runManager(
    manager,
    viewArgs(manager, name, yarn),
    projectDir
  );
  const releases =
    run.status === 0 ? parseReleases(parsed(run.stdout)) : undefined;
  if (releases !== undefined) return { kind: "found", releases };
  // The manager's own answer could not be read: asked directly, which also
  // tells a package the registry lacks from a registry that is not there.
  return askRegistry(projectDir, name);
}
