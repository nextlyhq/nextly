/**
 * How many of the Styles tab's styles a search matches, for the count the
 * Design panel shows beside the tab's name: its block looks and its shared
 * styles, each found by its name, class name, property or value.
 *
 * Built from the same parts the Styles tab lists with (its rows, each row's
 * search text and the one search), so the count beside the tab and the rows
 * under it are one answer.
 *
 * @module styles-tab-matches
 */
import type { NamedClass, StyleCompileContext } from "@nextlyhq/blocks-engine";

import { blockLookGroups } from "./block-look-rows";
import {
  searchSharedStyles,
  sharedStyleRows,
  sharedStyleSearchText,
  sharedStylesOnly,
} from "./shared-style-library";

/** How many block looks and shared styles the search matches; 0 with none. */
export function stylesTabMatches(
  library: readonly NamedClass[] | undefined,
  suppliedClassIds: readonly string[] | undefined,
  query: string,
  context: StyleCompileContext | undefined
): number {
  if (library === undefined || query.trim() === "") return 0;
  const supplied = new Set(suppliedClassIds ?? []);
  const textOf = (row: Parameters<typeof sharedStyleSearchText>[0]) =>
    sharedStyleSearchText(row, context);
  const styles = searchSharedStyles(
    sharedStyleRows(sharedStylesOnly(library), supplied),
    query,
    textOf
  ).length;
  const looks = blockLookGroups(library, supplied).reduce(
    (sum, group) => sum + searchSharedStyles(group.rows, query, textOf).length,
    0
  );
  return styles + looks;
}
