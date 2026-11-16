/**
 * What the Styles tab lists, and how many of its styles a search matches:
 * its block looks and its shared styles, each found by its name, class name,
 * property or value.
 *
 * One listing for both: the tab builds its rows with {@link stylesTabSource}
 * and narrows them with {@link foundSharedStyles} and {@link foundLooks}, and
 * {@link stylesTabMatches} counts through the same three, so the count the
 * Design panel shows beside the tab's name and the rows under it are one
 * answer.
 *
 * @module styles-tab-matches
 */
import type { NamedClass, StyleCompileContext } from "@nextlyhq/blocks-engine";

import {
  blockLookGroups,
  type BlockLookGroup,
  type BlockLookRow,
} from "./block-look-rows";
import {
  searchSharedStyles,
  sharedStyleRows,
  sharedStyleSearchText,
  sharedStylesOnly,
  type SharedStyleRow,
} from "./shared-style-library";

/** The Styles tab's rows before any search: shared styles, and looks by type. */
export interface StylesTabSource {
  readonly rows: SharedStyleRow[];
  readonly groups: BlockLookGroup[];
}

/** Every row the Styles tab can list, from the site's library. */
export function stylesTabSource(
  library: readonly NamedClass[],
  supplied: ReadonlySet<string>
): StylesTabSource {
  return {
    rows: sharedStyleRows(sharedStylesOnly(library), supplied),
    groups: blockLookGroups(library, supplied),
  };
}

/** The shared styles a search finds; every one with no search. */
export function foundSharedStyles(
  rows: readonly SharedStyleRow[],
  query: string,
  textOf: (row: SharedStyleRow) => string
): SharedStyleRow[] {
  return searchSharedStyles(rows, query, textOf);
}

/**
 * The looks a search finds, by block type; a type with none left is not
 * listed. Every type, whole, with no search.
 */
export function foundLooks(
  groups: readonly BlockLookGroup[],
  query: string,
  textOf: (row: BlockLookRow) => string
): BlockLookGroup[] {
  if (query.trim() === "") return [...groups];
  return groups
    .map(group => ({
      ...group,
      rows: searchSharedStyles(group.rows, query, textOf),
    }))
    .filter(group => group.rows.length > 0);
}

/** How many block looks and shared styles the search matches; 0 with none. */
export function stylesTabMatches(
  library: readonly NamedClass[] | undefined,
  suppliedClassIds: readonly string[] | undefined,
  query: string,
  context: StyleCompileContext | undefined
): number {
  if (library === undefined || query.trim() === "") return 0;
  const { rows, groups } = stylesTabSource(
    library,
    new Set(suppliedClassIds ?? [])
  );
  const textOf = (row: SharedStyleRow) => sharedStyleSearchText(row, context);
  const looks = foundLooks(groups, query, textOf);
  return (
    foundSharedStyles(rows, query, textOf).length +
    looks.reduce((sum, group) => sum + group.rows.length, 0)
  );
}
