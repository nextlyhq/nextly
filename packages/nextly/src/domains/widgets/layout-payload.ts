/**
 * The stored dashboard layout's payload: its format version, how it is
 * written, and how large one submission may be.
 *
 * Its own module, reaching only the import-free `layout-limits.ts`, for the
 * reason that one is: the admin has to know whether a save will fit before it
 * sends it, and it reaches core only through `nextly/config`, which is
 * published as safe for a browser. `layout.ts` imports `node:crypto`. Declared
 * here, the endpoint that refuses a submission and the editor that trims one
 * ask ONE question, so they cannot disagree about what fits.
 *
 * @module domains/widgets/layout-payload
 */

import { MAX_PLACEMENTS } from "./layout-limits";

/**
 * The shape this core writes and understands.
 *
 * Bumped only when the payload's structure changes, alongside a conversion that
 * carries the older shape forward. A row naming a version this core does not
 * have was written by a NEWER core, and is refused rather than guessed at,
 * because guessing would silently discard the fields this core cannot see.
 */
export const LAYOUT_SCHEMA_VERSION = 3;

/**
 * How large one layout's payload may be, in bytes.
 *
 * MySQL's `TEXT` is 65535 BYTES, and the other two dialects are effectively
 * unbounded, so without a cap the same PUT stores cleanly on two dialects and
 * fails or truncates on the third. 32 KiB is half MySQL's limit, leaving room
 * for multi-byte characters. `MAX_PLACEMENTS`, the count it shares a reason
 * with, is declared in `layout-limits.ts`.
 */
export const MAX_LAYOUT_BYTES = 32 * 1024;

/**
 * What a reader is told when their dashboard reaches `MAX_LAYOUT_BYTES`.
 *
 * In the reader's terms rather than the column's: they never see bytes, and
 * the cards and notes they placed are what fill it, so the sentence names the
 * two things they can do about it.
 */
export const DASHBOARD_FULL_MESSAGE =
  "This dashboard is full: remove a card or shorten a Note";

/**
 * The payload written into the `layout` column.
 *
 * `arranged` defaults to TRUE: a caller that says nothing is making the
 * ordinary kind of write, a save from customise mode. Generic over the
 * placement so this module needs no import of the placement type's module.
 */
export function serializeLayout<Placement extends object>(
  placements: readonly Placement[],
  arranged = true
): string {
  return JSON.stringify({
    schemaVersion: LAYOUT_SCHEMA_VERSION,
    placements,
    ...(arranged ? {} : { unarranged: true }),
  });
}

/**
 * Why the caller's OWN submission cannot be stored, or `undefined`.
 *
 * 🔴 Measures only what the caller sent. A budget that also weighed the cards
 * carried back on their behalf would make ACCEPTANCE depend on data they
 * cannot see, and the pass/fail edge would be the oracle.
 */
export function layoutSizeProblem<Placement extends object>(
  placements: readonly Placement[]
): string | undefined {
  if (placements.length > MAX_PLACEMENTS) {
    return `a layout may hold at most ${MAX_PLACEMENTS} placements`;
  }
  // Byte length, not string length: the column's limit is bytes. A
  // `TextEncoder` rather than `Buffer`, so a browser measures it the same way.
  const bytes = new TextEncoder().encode(serializeLayout(placements)).length;
  if (bytes > MAX_LAYOUT_BYTES) {
    return DASHBOARD_FULL_MESSAGE;
  }
  return undefined;
}
