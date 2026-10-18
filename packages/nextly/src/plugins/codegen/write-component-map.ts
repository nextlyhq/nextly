/**
 * Writes the two generated component-map files, for `nextly generate:types`
 * and for the admin's development check, so the files a developer commits
 * are written one way whichever of the two wrote them.
 *
 * A file is written only when its content changes. Next watches these files
 * in development, so rewriting an unchanged file would reload the admin for
 * nothing, and the development check runs on every admin render.
 *
 * @module plugins/codegen/write-component-map
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PluginDefinition } from "../plugin-context";

import { buildImportMapArtifacts } from "./component-import-map";

/** Where the files were written, and which of them changed. */
export interface ComponentMapWrite {
  readonly paths: readonly string[];
  readonly changed: readonly string[];
}

/**
 * Writes the map and its path list beside the generated types file, resolved
 * against `cwd`, creating the folder when it is missing.
 *
 * 🔴 Both files are read before either is written. The map refuses to load
 * when it disagrees with its list, so replacing one and then failing to read
 * the other would leave a pair that breaks the admin; reading first, a file
 * that cannot be read stops the write with the pair as it was.
 */
export async function writeComponentMapFiles(
  plugins: PluginDefinition[],
  typesOutputPath: string,
  cwd: string
): Promise<ComponentMapWrite> {
  const planned = await Promise.all(
    buildImportMapArtifacts(plugins, typesOutputPath).map(async artifact => {
      const file = resolve(cwd, artifact.path);
      return {
        file,
        code: artifact.code,
        unchanged: (await currentContent(file)) === artifact.code,
      };
    })
  );
  const changed: string[] = [];
  for (const each of planned) {
    if (each.unchanged) continue;
    await mkdir(dirname(each.file), { recursive: true });
    await writeFile(each.file, each.code, "utf-8");
    changed.push(each.file);
  }
  return { paths: planned.map(each => each.file), changed };
}

/**
 * A file's content, or `undefined` when there is no file.
 *
 * 🔴 Only a missing file reads as none. Writing replaces the whole file, so a
 * file that exists but could not be read (no read permission, an I/O error) is
 * one this would otherwise truncate unseen: the failure is thrown instead, and
 * nothing is written.
 */
async function currentContent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
