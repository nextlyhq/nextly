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
import { type RefObject, useEffect, useRef } from "react";

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

/**
 * The pager's height is kept per band of its width: its controls wrap by the
 * width they are given, so a height kept at one width says nothing of
 * another. Bands this wide keep a pager drawn a few pixels apart as one.
 */
const PAGER_WIDTH_BAND_PX = 32;

/** The name a list's pager height is kept under, at one band of width. */
function listPagerPart(list: string, width: number): string {
  return `list-pager:${list}:${Math.round(width / PAGER_WIDTH_BAND_PX)}`;
}

/**
 * How tall the list's pager stood the last time it was drawn this wide, or
 * nothing where it has not been: a pager of several pages has more buttons
 * than the outline's first guess of one page, and wraps onto more lines.
 */
export function recallListPager(
  list: string,
  width: number
): number | undefined {
  const kept = recallLayout(listPagerPart(list, width));
  return kept !== undefined && kept > 0 ? kept : undefined;
}

/** Keeps how tall the list's pager stands at this width, for its outline. */
function rememberListPager(list: string, width: number, height: number): void {
  rememberLayout(listPagerPart(list, width), Math.round(height));
}

/**
 * The list's pager, to be handed as its ref: how tall it stands, at the width
 * it is drawn, is kept after each draw for the list's outline next time.
 */
export function useRememberedListPager(
  list: string | undefined
): RefObject<HTMLElement | null> {
  const pager = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = pager.current;
    if (list === undefined || element === null) return;
    const { width, height } = element.getBoundingClientRect();
    if (width > 0 && height > 0) rememberListPager(list, width, height);
  });
  return pager;
}
