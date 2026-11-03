/**
 * Judging the blocks values a row holds where no fixed path reaches them.
 *
 * A blocks field inside a repeater has one value per row of the repeater, and
 * none of them has an address a write of one field can name. They can still
 * be READ: the row is searched for every value shaped like a blocks document,
 * and each is handed to the step. One the step would change is reported, never
 * written, and so is a row too large to search to the end, because a value the
 * search never reached is one it cannot vouch for.
 *
 * @module host-rewrite/scan
 */
import { isPlainRecord } from "@nextlyhq/blocks-engine";

import { asDocument } from "../component-store-source";

import type { HostStep, StoredForm } from "./contract";

/** How many values one row's search visits before it counts as unreadable. */
const MOST_VALUES_SEARCHED = 50_000;

/** What judging a row's values came to. */
export type ScanOutcome = "unchanged" | "unaddressable" | "unreadable";

/**
 * Hand every blocks value in `row` to `step`. `unaddressable` when the step
 * would change or refuses one; `unreadable` when the row could not be searched
 * to the end.
 */
export async function scannedOutcomes(
  step: HostStep,
  row: unknown,
  form: StoredForm
): Promise<ScanOutcome> {
  const found = documentsWithin(row);
  if (found === null) return "unreadable";
  for (const document of found) {
    const outcome = await step(document, form);
    if (outcome.kind !== "unchanged") return "unaddressable";
  }
  return "unchanged";
}

/**
 * Every value in `row` shaped like a blocks document, outermost first, or
 * `null` when the search ran past its bound. A document's own nodes are not
 * searched again: what it places is the step's to judge.
 */
function documentsWithin(row: unknown): unknown[] | null {
  const found: unknown[] = [];
  const stack: unknown[] = [row];
  let visited = 0;
  while (stack.length > 0) {
    visited += 1;
    if (visited > MOST_VALUES_SEARCHED) return null;
    const value = stack.pop();
    if (value !== row && asDocument(value) !== null) {
      found.push(value);
      continue;
    }
    // One at a time rather than spread: a long list spread into arguments
    // reaches the engine's argument limit before any bound applies.
    const inner = Array.isArray(value)
      ? value
      : isPlainRecord(value)
        ? Object.values(value)
        : [];
    for (const item of inner) stack.push(item);
  }
  return found;
}
