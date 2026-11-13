/**
 * How many rows a list's outline draws: as many as the list drew the last
 * time this person opened it, kept on the device as a number alone
 * (`rememberLayout`), or five where it has not been opened here before.
 *
 * One name per list, for the list itself and for every outline of it, so the
 * outline the frame draws before the list's code has loaded, the list's own
 * outline while its rows are on their way, and the rows that replace them
 * stand as tall as each other on every visit after the first.
 *
 * @module components/shared/loading-frame/list-rows
 */
import { useEffect } from "react";

import {
  recallLayout,
  rememberLayout,
} from "@admin/lib/device-memory/device-memory";

/**
 * The rows an outline draws for a list never opened here: a page of the
 * list's own can be shorter or longer, so this is a guess, held to a short
 * list's length.
 */
export const FIRST_GUESS_ROWS = 5;

/** The name a list's drawn row count is kept under. */
function listRowsPart(list: string): string {
  return `list-rows:${list}`;
}

/**
 * How many rows the outline of the list named `list` draws: the count it last
 * drew, where that was one or more, else {@link FIRST_GUESS_ROWS}. An empty
 * list draws its empty state rather than rows, so a remembered none is no
 * guide to the rows a list that has gained some will draw.
 */
export function outlineRowsFor(list: string | undefined): number {
  const kept =
    list === undefined ? undefined : recallLayout(listRowsPart(list));
  return kept !== undefined && kept > 0 ? kept : FIRST_GUESS_ROWS;
}

/**
 * Keep how many rows the list named `list` drew, once it has drawn them
 * (`drawn` is undefined while they are on their way).
 */
export function useRememberedListRows(
  list: string | undefined,
  drawn: number | undefined
): void {
  useEffect(() => {
    if (list === undefined || drawn === undefined) return;
    rememberLayout(listRowsPart(list), drawn);
  }, [list, drawn]);
}
