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

import type {
  NamedClass,
  NodeStyles,
  StyleValue,
} from "@nextlyhq/blocks-engine";

/** A record's own entries, or none for anything that isn't a plain record. */
function entriesOf(value: unknown): [string, unknown][] {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.entries(value)
    : [];
}

/** A record's own entry at a key, or `undefined`. */
function at(value: unknown, key: string): unknown {
  return typeof value === "object" &&
    value !== null &&
    Object.hasOwn(value, key)
    ? (value as Record<string, unknown>)[key]
    : undefined;
}

/** Whether two stored values are the same value, as JSON compares them. */
function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** The keys either of several records holds, in first-seen order. */
function keysOf(...records: unknown[]): string[] {
  return [
    ...new Set(
      records.flatMap(record => entriesOf(record).map(([key]) => key))
    ),
  ];
}

/** A record built with own keys, whatever their names. */
function recordOf<T>(entries: readonly [string, T][]): Record<string, T> {
  const out: Record<string, T> = {};
  for (const [key, value] of entries) {
    Object.defineProperty(out, key, {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

/**
 * One breakpoint's values rebased: a property the stored entry holds as the
 * old code did follows the new code; the site's own values are kept, and a
 * property the site cleared stays cleared.
 */
function rebasedValues(
  stored: unknown,
  was: unknown,
  now: unknown
): Record<string, StyleValue> {
  const out: [string, StyleValue][] = [];
  for (const property of keysOf(stored, was, now)) {
    const mine = at(stored, property);
    const before = at(was, property);
    const code = at(now, property);
    // The site's own: a value it set or changed, or one it cleared.
    const own = !same(mine, before);
    const value = own ? mine : code;
    if (value !== undefined) out.push([property, value as StyleValue]);
  }
  return recordOf(out);
}

/** Styles rebased state by state and breakpoint by breakpoint. */
function rebasedStyles(
  stored: unknown,
  was: unknown,
  now: unknown
): NodeStyles {
  const states: [string, Record<string, Record<string, StyleValue>>][] = [];
  for (const state of keysOf(stored, was, now)) {
    const byBreakpoint: [string, Record<string, StyleValue>][] = [];
    for (const breakpoint of keysOf(
      at(stored, state),
      at(was, state),
      at(now, state)
    )) {
      const values = rebasedValues(
        at(at(stored, state), breakpoint),
        at(at(was, state), breakpoint),
        at(at(now, state), breakpoint)
      );
      if (Object.keys(values).length > 0)
        byBreakpoint.push([breakpoint, values]);
    }
    if (byBreakpoint.length > 0) states.push([state, recordOf(byBreakpoint)]);
  }
  return recordOf(states);
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
  // The entry's other fields follow the same rule: the site's own if it
  // changed them, else the code's as it now is.
  const field = <K extends keyof NamedClass>(key: K): NamedClass[K] =>
    same(stored[key], was[key]) && now !== undefined ? now[key] : stored[key];
  if (now === undefined && same(styles, {}) && same(stored.slug, was.slug)) {
    return undefined;
  }
  const rebased: NamedClass = {
    ...stored,
    slug: field("slug"),
    orderIndex: field("orderIndex"),
    styles,
  };
  const label = field("label");
  if (label === undefined) delete rebased.label;
  else rebased.label = label;
  return rebased;
}
