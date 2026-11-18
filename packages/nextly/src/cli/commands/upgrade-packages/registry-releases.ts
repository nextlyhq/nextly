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

import { runManager, viewArgs, type PackageManager } from "./package-manager";
import type { RegistryReleases } from "./release-choice";

export type RegistryAnswer =
  | { kind: "found"; releases: RegistryReleases }
  /** The registry was reached and has no such package. */
  | { kind: "missing" }
  /** The registry could not be asked; `why` is what was said. */
  | { kind: "unreadable"; why: string };

const DEFAULT_REGISTRY = "https://registry.npmjs.org";

/** The tags and versions in a package document, in whichever shape it came. */
function releasesIn(document: unknown): RegistryReleases | undefined {
  if (document === null || typeof document !== "object") return undefined;
  const { "dist-tags": tags, versions } = document as {
    "dist-tags"?: unknown;
    versions?: unknown;
  };
  if (tags === null || typeof tags !== "object") return undefined;
  // A list from a manager's own view, one name where there is one version,
  // and a map by version in the registry's own document.
  const list = Array.isArray(versions)
    ? versions
    : typeof versions === "string"
      ? [versions]
      : versions !== null && typeof versions === "object"
        ? Object.keys(versions)
        : [];
  // A document naming no version says nothing of what is published.
  if (list.length === 0) return undefined;
  return {
    tags: Object.fromEntries(
      Object.entries(tags).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string"
      )
    ),
    versions: list.filter(
      (version): version is string => typeof version === "string"
    ),
  };
}

/** `text` parsed as JSON, or undefined where it is not. */
function parsed(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

/**
 * The registry the project's `.npmrc` names for `name`, from the project
 * folder upwards: its scope's own registry first, then the default one.
 */
function registryFor(projectDir: string, name: string): string {
  const scope = name.startsWith("@") ? name.split("/")[0] : undefined;
  let fallback: string | undefined;
  for (let dir = projectDir; ; dir = dirname(dir)) {
    const file = join(dir, ".npmrc");
    const lines = existsSync(file)
      ? readFileSync(file, "utf8").split(/\r?\n/)
      : [];
    for (const line of lines) {
      const [key, value] = line.split("=").map(part => part.trim());
      if (value === undefined || value === "") continue;
      if (scope !== undefined && key === `${scope}:registry`) return value;
      if (key === "registry") fallback ??= value;
    }
    if (dirname(dir) === dir) break;
  }
  return fallback ?? DEFAULT_REGISTRY;
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
      ? releasesIn(await response.json())
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
  name: string
): Promise<RegistryAnswer> {
  const run = await runManager(manager, viewArgs(manager, name), projectDir);
  const releases =
    run.status === 0 ? releasesIn(parsed(run.stdout)) : undefined;
  if (releases !== undefined) return { kind: "found", releases };
  // The manager's own answer could not be read: asked directly, which also
  // tells a package the registry lacks from a registry that is not there.
  return askRegistry(projectDir, name);
}
