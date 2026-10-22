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

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import type { PluginDefinition } from "../plugin-context";

import {
  buildImportMapArtifacts,
  configImportSpecifier,
} from "./component-import-map";

/** Where the files were written, and which of them changed. */
export interface ComponentMapWrite {
  readonly paths: readonly string[];
  readonly changed: readonly string[];
}

/**
 * Writes the map and its path list beside the generated types file, resolved
 * against `cwd`, creating the folder when it is missing.
 *
 * 🔴 The pair changes together or not at all. The map refuses to load when it
 * disagrees with its list, so one file replaced and the other not leaves an
 * admin that does not load, where the old pair at least agreed. So both are
 * read before either is written, and a file that cannot be read stops the
 * write unchanged; and when a write fails, every file it started on is put
 * back as it was read before the error is thrown.
 */
export async function writeComponentMapFiles(
  plugins: PluginDefinition[],
  typesOutputPath: string,
  cwd: string,
  /**
   * The site's config, for the map's check of each widget component against its widget: its file,
   * whose import is worked out from where the map sits, or an import an earlier write chose, kept
   * as it stands. None where there is no config, and the map is then written unchecked, as before.
   */
  config?: string | { import: string }
): Promise<ComponentMapWrite> {
  const configImport =
    config === undefined || typeof config !== "string"
      ? config?.import
      : configImportSpecifier(
          resolve(cwd, dirname(typesOutputPath)),
          resolve(cwd, config)
        );
  const planned = await Promise.all(
    buildImportMapArtifacts(plugins, typesOutputPath, configImport).map(
      async artifact => {
        const file = resolve(cwd, artifact.path);
        return {
          file,
          code: artifact.code,
          previous: await currentContent(file),
        };
      }
    )
  );
  // Every file a write was started on, the failing one included: a write
  // that fails partway can leave its own file cut short.
  const touched: (typeof planned)[number][] = [];
  try {
    for (const each of planned) {
      if (each.previous === each.code) continue;
      touched.push(each);
      await mkdir(dirname(each.file), { recursive: true });
      await writeFile(each.file, each.code, "utf-8");
    }
  } catch (error) {
    await restore(touched);
    throw error;
  }
  return {
    paths: planned.map(each => each.file),
    changed: touched.map(each => each.file),
  };
}

/**
 * Puts back files this write replaced: the content read before writing, or no
 * file where there was none. Best effort, since it runs while a write is
 * already failing: the error the caller sees is that write's.
 */
async function restore(
  written: readonly { file: string; previous: string | undefined }[]
): Promise<void> {
  await Promise.allSettled(
    written.map(each =>
      each.previous === undefined
        ? rm(each.file, { force: true })
        : writeFile(each.file, each.previous, "utf-8")
    )
  );
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
