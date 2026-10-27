/**
 * Whether an app's committed component map agrees with what its config declares: the check
 * `nextly generate:types --check` runs in CI, which reads and writes nothing else.
 *
 * Compared by the paths the strings-only list holds, not by the files' text: the generator writes
 * the list on one line, and a formatter run over the commit lays it out a path a line, so text
 * alone would call every formatted map stale. The map is held to its list by its own type
 * (`componentMapAgreesWithList`) and to each widget's props by `DeclaredComponentMap`, both
 * judged where the app type-checks; so the list agreeing with the declarations, and both files
 * being there, is what this has left to judge.
 *
 * The declared side is {@link componentImportMapEntries}, the list the generator itself writes
 * from, so the check and the generator cannot disagree about what belongs in the map.
 *
 * @module plugins/codegen/check-component-map
 */

import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";

import type { PluginDefinition } from "../plugin-context";

import {
  COMPONENT_IMPORT_MAP_FILENAME,
  COMPONENT_PATHS_FILENAME,
  componentImportMapEntries,
  type ComponentMapEntry,
  listedPathsOf,
} from "./component-import-map";

/** What the check found: each way the committed map can disagree with the declarations. */
export interface ComponentMapAgreement {
  /** The two generated files, absolute, the map first. */
  readonly files: readonly [map: string, list: string];
  /** Those of the two files that are not there at all. */
  readonly absent: readonly string[];
  /** Whether the list is in a shape the generator writes; an unreadable list agrees with nothing. */
  readonly listReadable: boolean;
  /** Components the declarations draw with that the committed list does not hold. */
  readonly missing: readonly ComponentMapEntry[];
  /** Paths the committed list holds that nothing declares any more. */
  readonly obsolete: readonly string[];
}

/** Whether the committed map agrees with the declarations: nothing absent, missing or obsolete. */
export function componentMapAgrees(found: ComponentMapAgreement): boolean {
  return (
    found.absent.length === 0 &&
    found.listReadable &&
    found.missing.length === 0 &&
    found.obsolete.length === 0
  );
}

/**
 * Compares the map committed beside the generated types file, resolved against `cwd`, with
 * what `plugins` declare. Throws only when a file that is there cannot be read, which is a
 * question the check could not ask rather than an answer.
 */
export async function checkComponentMapFiles(
  plugins: readonly PluginDefinition[],
  typesOutputPath: string,
  cwd: string
): Promise<ComponentMapAgreement> {
  const dir = resolve(cwd, dirname(typesOutputPath));
  const files = [
    join(dir, COMPONENT_IMPORT_MAP_FILENAME),
    join(dir, COMPONENT_PATHS_FILENAME),
  ] as const;
  const [map, list] = await Promise.all(files.map(contentOf));
  const listed = list === undefined ? [] : listedPathsOf(list);
  const declared = componentImportMapEntries(plugins);
  const held = new Set(listed ?? []);
  const declaredPaths = new Set(declared.map(each => each.path));
  return {
    files,
    absent: files.filter((_, index) => [map, list][index] === undefined),
    listReadable: list === undefined || listed !== undefined,
    missing: declared.filter(each => !held.has(each.path)),
    obsolete: (listed ?? []).filter(path => !declaredPaths.has(path)),
  };
}

/** A file's text, or `undefined` when there is no file; any other failure to read is thrown. */
async function contentOf(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf-8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}
