/**
 * What a module loads when it is imported: the modules and packages it
 * reaches through static imports, as esbuild resolves them. A type-only
 * import is erased, and an `import()` runs only when its code does, so
 * neither counts.
 */
import { isBuiltin } from "node:module";
import { relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { build, type Metafile } from "esbuild";

/** `packages/nextly/src`. */
const SOURCE = fileURLToPath(new URL("../../../", import.meta.url));

/** What importing a module loads. */
export interface RuntimeImports {
  /** The package's own modules, as paths under `src`, the entry first. */
  modules: string[];
  /**
   * Every specifier of another package reached, Node's own modules left out,
   * with the modules that lead to it from the entry.
   */
  packages: Map<string, string[]>;
}

/** What importing `entry`, a path under `src`, loads. */
export async function runtimeImportsOf(entry: string): Promise<RuntimeImports> {
  const { metafile } = await build({
    absWorkingDir: SOURCE,
    entryPoints: [resolve(SOURCE, entry)],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    metafile: true,
    logLevel: "silent",
    // Another package is named, not read: what it loads is its own.
    packages: "external",
    outdir: resolve(SOURCE, "unwritten"),
  });
  return walk(metafile, inputName(relative(SOURCE, resolve(SOURCE, entry))));
}

/**
 * `path` as esbuild names an input: with forward slashes on every platform,
 * Windows among them, whose own separator is a backslash.
 */
export function inputName(path: string, separator: string = sep): string {
  return path.split(separator).join("/");
}

/** The modules and packages `entry` reaches in `metafile` through static imports. */
function walk(metafile: Metafile, entry: string): RuntimeImports {
  const packages = new Map<string, string[]>();
  const reachedBy = new Map<string, string[]>([[entry, [entry]]]);
  const queue = [entry];
  for (let file = queue.shift(); file !== undefined; file = queue.shift()) {
    const chain = reachedBy.get(file) ?? [];
    for (const { path, kind, external } of metafile.inputs[file].imports) {
      if (kind === "dynamic-import") continue;
      if (external) {
        if (!isBuiltin(path) && !packages.has(path)) packages.set(path, chain);
      } else if (!reachedBy.has(path)) {
        reachedBy.set(path, [...chain, path]);
        queue.push(path);
      }
    }
  }
  return { modules: [...reachedBy.keys()], packages };
}
