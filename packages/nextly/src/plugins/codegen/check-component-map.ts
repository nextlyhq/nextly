/**
 * Whether an app's committed component map agrees with what its config declares: the check
 * `nextly generate:types --check` runs in CI, which reads and writes nothing else.
 *
 * Compared by the paths each file holds, not by the files' text: the generator writes the list
 * on one line, and a formatter run over the commit lays it out a path a line, so text alone would
 * call every formatted map stale. Both files are read: the list for what it names, and the map
 * for what it REGISTERS. A map emptied by hand, or cut short, registers nothing and carries no
 * check of itself against its list, so a list that still agreed would otherwise pass for both.
 * Each widget's props against its component are the map's `DeclaredComponentMap`, judged where
 * the app type-checks.
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
  mapRegisteredPathsOf,
} from "./component-import-map";

/** What the check found: each way the committed map can disagree with the declarations. */
export interface ComponentMapAgreement {
  /** The two generated files, absolute, the map first. */
  readonly files: readonly [map: string, list: string];
  /** Those of the two files that are not there at all. */
  readonly absent: readonly string[];
  /** Whether the list is in a shape the generator writes; an unreadable list agrees with nothing. */
  readonly listReadable: boolean;
  /**
   * Whether the map registers exactly the paths its list names, in a shape the generator writes:
   * `false` for a map emptied, cut short or edited so it no longer matches its list.
   */
  readonly mapMatchesList: boolean;
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
    found.mapMatchesList &&
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
    mapMatchesList:
      map === undefined || sameSet(mapRegisteredPathsOf(map), listed),
    missing: declared.filter(each => !held.has(each.path)),
    obsolete: (listed ?? []).filter(path => !declaredPaths.has(path)),
  };
}

/** Whether two path lists hold the same paths; never for a list that could not be read. */
function sameSet(
  a: readonly string[] | undefined,
  b: readonly string[] | undefined
): boolean {
  if (a === undefined || b === undefined) return false;
  const inA = new Set(a);
  return inA.size === new Set(b).size && b.every(path => inA.has(path));
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
