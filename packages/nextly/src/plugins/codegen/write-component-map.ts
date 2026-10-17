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
 */
export async function writeComponentMapFiles(
  plugins: PluginDefinition[],
  typesOutputPath: string,
  cwd: string
): Promise<ComponentMapWrite> {
  const paths: string[] = [];
  const changed: string[] = [];
  for (const artifact of buildImportMapArtifacts(plugins, typesOutputPath)) {
    const file = resolve(cwd, artifact.path);
    paths.push(file);
    if ((await currentContent(file)) === artifact.code) continue;
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, artifact.code, "utf-8");
    changed.push(file);
  }
  return { paths, changed };
}

/** A file's content, or `undefined` when there is none to read. */
async function currentContent(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf-8");
  } catch {
    return undefined;
  }
}
