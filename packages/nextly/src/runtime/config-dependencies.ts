// What: the files to watch for a project's config when no load has reported
// them: the config and every local file it imports, found by compiling it
// without running it. Without a config, the places one would be found.
//
// Why compile rather than load: loading runs the config, which registers its
// field types and replaces the cached config. The watcher only needs the file
// list, and needs it at times a load is not wanted or has just failed: at
// startup with the boot apply turned off, and after a save that broke an
// imported file, where the fix will be saved to that file.

import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { nodeModulesExternalPlugin } from "../cli/utils/config-bundler";
import {
  findNextlyConfig,
  SEARCH_DIRECTORIES,
  SUPPORTED_EXTENSIONS,
} from "../cli/utils/config-loader";
import { loadEsbuild } from "../cli/utils/esbuild-loader";

/** Absolute paths: the config and its imports, or where a config would be. */
export async function configFilesToWatch(cwd: string): Promise<string[]> {
  const configPath = findNextlyConfig(cwd);
  if (!configPath) return configLocations(cwd);
  return [configPath, ...(await importedFiles(configPath))];
}

/** Every path the loader looks for a config at, in folders that exist. */
function configLocations(cwd: string): string[] {
  return SEARCH_DIRECTORIES.map(dir => resolve(cwd, dir))
    .filter(dir => existsSync(dir))
    .flatMap(dir => SUPPORTED_EXTENSIONS.map(name => resolve(dir, name)));
}

async function importedFiles(configPath: string): Promise<string[]> {
  // esbuild reports paths relative to its working directory, which is the
  // config's folder here as it is for the loader.
  const root = dirname(configPath);
  try {
    const { build } = await loadEsbuild();
    const result = await build({
      entryPoints: [configPath],
      bundle: true,
      platform: "node",
      format: "esm",
      write: false,
      metafile: true,
      logLevel: "silent",
      // The loader's own rule, so the scan follows the files a load compiles.
      plugins: [nodeModulesExternalPlugin],
      absWorkingDir: root,
    });
    return Object.keys(result.metafile?.inputs ?? {}).map(input =>
      resolve(root, input)
    );
  } catch (error) {
    // A file that does not compile stops the scan. The files its errors name
    // are where the fix will be saved, and so is a local import that does not
    // exist yet: creating it is the fix.
    return failedFiles(error).flatMap(file => {
      const watchable = createdFirst(resolve(root, file));
      return watchable ? [watchable] : [];
    });
  }
}

/**
 * The path whose appearance is the first step towards `file` existing: the
 * file itself when its folder exists, otherwise the first missing folder on
 * its way, in the nearest folder that does exist. Creating that folder reloads,
 * and the reload's scan then watches the next step from inside it. Undefined
 * when no folder on the way exists.
 */
function createdFirst(file: string): string | undefined {
  let path = file;
  while (!existsSync(dirname(path))) {
    const parent = dirname(path);
    if (parent === path) return undefined;
    path = parent;
  }
  return path;
}

// What esbuild tries for an import written without an extension, in its
// default order, and the same names as a folder's index file.
const RESOLVE_EXTENSIONS = [".tsx", ".ts", ".jsx", ".js", ".css", ".json"];

function failedFiles(error: unknown): string[] {
  const errors = (error as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap(entry => {
    const { text, location } = entry as {
      text?: unknown;
      location?: { file?: unknown } | null;
    };
    const file = location?.file;
    if (typeof file !== "string" || !file) return [];
    // esbuild reports an import it cannot find at the importing line.
    const missing =
      typeof text === "string"
        ? /^Could not resolve "(\.{1,2}\/[^"]+)"/.exec(text)?.[1]
        : undefined;
    if (!missing) return [file];
    const target = join(dirname(file), missing);
    return [
      file,
      target,
      ...RESOLVE_EXTENSIONS.map(extension => target + extension),
      ...RESOLVE_EXTENSIONS.map(extension => join(target, `index${extension}`)),
    ];
  });
}
