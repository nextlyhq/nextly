/**
 * The package `nextly plugins add` installed, read from the project the way
 * Node resolves a bare name from it: `node_modules/<name>` in the project's
 * folder or the nearest folder above it that has one. Its manifest says how it
 * is registered; its entry, the file an `import` of the name loads, is what
 * the config will import.
 *
 * @module cli/commands/plugins-add/installed-package
 */
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * The package name in a spec as typed: `@acme/seo@^1` is `@acme/seo`, and
 * `seo@alpha` is `seo`. Anything else, such as a folder or a git address, is
 * returned as it is, and is found only if a package is installed by that name.
 */
export function packageNameOf(spec: string): string {
  const at = spec.indexOf("@", spec.startsWith("@") ? 1 : 0);
  return at === -1 ? spec : spec.slice(0, at);
}

/** A package's manifest, as far as this reads it. */
export type PackageManifest = Record<string, unknown>;

/** The installed package's folder and manifest, or nothing when it is not installed. */
export async function findInstalledPackage(
  cwd: string,
  name: string
): Promise<{ dir: string; manifest: PackageManifest } | undefined> {
  for (let at = cwd; ; at = dirname(at)) {
    const dir = join(at, "node_modules", ...name.split("/"));
    const text = await readFile(join(dir, "package.json"), "utf8").catch(
      () => undefined
    );
    if (text !== undefined) {
      const manifest: unknown = JSON.parse(text);
      if (typeof manifest === "object" && manifest !== null) {
        return { dir, manifest: manifest as PackageManifest };
      }
    }
    if (dirname(at) === at) return undefined;
  }
}

/** The conditions an `import` from Node matches by default, as Node checks them. */
const IMPORT_CONDITIONS = new Set(["node-addons", "node", "import", "default"]);

/** The file an exports target names for an import: the first matching condition, in written order. */
function exportTarget(target: unknown): string | undefined {
  if (typeof target === "string") return target;
  if (Array.isArray(target)) {
    for (const each of target) {
      const found = exportTarget(each);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof target !== "object" || target === null) return undefined;
  for (const [condition, value] of Object.entries(target)) {
    if (!IMPORT_CONDITIONS.has(condition)) continue;
    const found = exportTarget(value);
    if (found !== undefined) return found;
  }
  return undefined;
}

/** The files Node tries for a package's `main`, in its order, then the package's own index. */
const LEGACY_MAIN = (main: string): string[] => [
  main,
  `${main}.js`,
  `${main}.json`,
  `${main}.node`,
  join(main, "index.js"),
  join(main, "index.json"),
  join(main, "index.node"),
];

/** Whether `path` is a file (not a folder). */
function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/**
 * The file an `import` of the package's name loads: from `exports` when the
 * package has them, by the conditions an import matches; otherwise its `main`
 * as Node resolves one, trying the extensions and an index in it, and then
 * `index.js`. `module` is a bundler's field, which Node does not read.
 */
export function entryFileOf(dir: string, manifest: PackageManifest): string {
  const { exports } = manifest;
  if (exports !== undefined) {
    const root =
      typeof exports === "object" &&
      exports !== null &&
      !Array.isArray(exports) &&
      Object.keys(exports).some(key => key.startsWith("."))
        ? (exports as Record<string, unknown>)["."]
        : exports;
    return join(dir, exportTarget(root) ?? "index.js");
  }
  const main = typeof manifest.main === "string" ? manifest.main : undefined;
  const tried = main === undefined ? [] : LEGACY_MAIN(join(dir, main));
  return tried.find(isFile) ?? join(dir, "index.js");
}

/** The package's entry, imported, as a record of its exports. */
export async function importEntry(
  dir: string,
  manifest: PackageManifest
): Promise<Record<string, unknown>> {
  const loaded: unknown = await import(
    pathToFileURL(entryFileOf(dir, manifest)).href
  );
  return { ...(loaded as Record<string, unknown>) };
}
