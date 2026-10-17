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
import { dirname, resolve } from "node:path";

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
    // are where the fix will be saved.
    return failedFiles(error).map(file => resolve(root, file));
  }
}

function failedFiles(error: unknown): string[] {
  const errors = (error as { errors?: unknown } | null)?.errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap(entry => {
    const file = (entry as { location?: { file?: unknown } | null })?.location
      ?.file;
    return typeof file === "string" && file ? [file] : [];
  });
}
