/**
 * A stored override of a code-supplied shared style, moved onto the code as
 * it is now.
 *
 * A style the site's code supplies is stored only while the site changed
 * it, and stored whole. When the code changes after an edit was recorded,
 * the stored entry still carries the code's old values beside the site's own
 * changes, so a replay applied to it would write the old code back and mask
 * the new. Rebased first, the entry keeps only what the site changed from
 * the code it was recorded against, laid over the code as it is now.
 *
 * Compared property by property, at each state and breakpoint: a value the
 * stored entry holds as the old code had it is the code's, and follows the
 * code; anything else is the site's own and is kept.
 *
 * @module class-override-rebase
 */

import type { NamedClass, NodeStyles } from "@nextlyhq/blocks-engine";

import {
  mergedValue,
  ownKeysOf as keysOf,
  ownRecordOf as recordOf,
  ownValueAt as at,
} from "../../site-style-merge";

/** Whether two stored values are the same value, as JSON compares them. */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Styles rebased state by state, breakpoint by breakpoint and property by
 * property: the three-way merge of the site's styles from the old code onto
 * the new, where the site's own value wins wherever both changed it. A value
 * the stored entry holds as the old code did follows the new code; the
 * site's own value is kept, and one it cleared stays cleared. One rule with
 * the editor's merge of a section onto a newer save, so the two cannot
 * drift.
 */
function rebasedStyles(
  stored: unknown,
  was: unknown,
  now: unknown
): NodeStyles {
  const merged = mergedValue(was, stored, now, { prefer: "mine" });
  return merged ?? {};
}

/**
 * The stored entry rebased from the code it was recorded against (`was`)
 * onto the code as it is now (`now`), or `undefined` once nothing of the
 * site's own is left and the code no longer supplies the style.
 *
 * An entry the code never supplied is returned as it is.
 */
export function rebasedOnCode(
  stored: NamedClass,
  was: NamedClass | undefined,
  now: NamedClass | undefined
): NamedClass | undefined {
  if (was === undefined) return stored;
  const styles = rebasedStyles(stored.styles, was.styles, now?.styles);
  // Gone only when nothing of the site's own is left in ANY field: a rename,
  // a lock or a moved position is the site's as much as a value is.
  const ownFields = keysOf(stored, was).filter(
    key => key !== "styles" && !same(at(stored, key), at(was, key))
  );
  if (now === undefined && same(styles, {}) && ownFields.length === 0) {
    return undefined;
  }
  // Every other field by the same rule, the lock and the label among them:
  // the site's own if it changed it, else the code's as it now is (absent
  // where the code now has none).
  const fields: [string, unknown][] = [];
  for (const key of keysOf(stored, was, now)) {
    if (key === "styles") continue;
    const value =
      key !== "id" && now !== undefined && same(at(stored, key), at(was, key))
        ? at(now, key)
        : at(stored, key);
    if (value !== undefined) fields.push([key, value]);
  }
  return { ...recordOf(fields), styles } as NamedClass;
}
