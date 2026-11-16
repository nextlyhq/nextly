/**
 * One style envelope laid over another, state by state, breakpoint by breakpoint and property by
 * property: the over tier's value wins where it sets one, and a composite value (the sides of a
 * padding) is merged side by side.
 *
 * The one implementation of that layering. The editor uses it for what Detach leaves on a block (a
 * shared style's values with the block's over them), and the renderer for a block type's base with
 * the site's edits to its own look over it. Stored envelopes are read by their own entries and
 * written with defined keys, so a key named `__proto__` stays data rather than reaching the
 * object's prototype.
 *
 * @module overlaid-styles
 * @experimental
 */

import { isTokenRef, type NodeStyles, type StyleValue } from "../document";
import { isPlainRecord } from "../plain-record";

/** Whether a stored value holds named sub-values (a token reference does not). */
function isComposite(
  value: StyleValue | undefined
): value is { readonly [key: string]: StyleValue } {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !isTokenRef(value)
  );
}

/** A record's own entries, with `__proto__` read as a key like any other. */
function ownEntries<T>(record: unknown): [string, T][] {
  // A stored tier that is null, a primitive or an array holds nothing the
  // compiler emits, and is read as empty here rather than thrown on.
  return isPlainRecord(record) ? (Object.entries(record) as [string, T][]) : [];
}

/** A copy of a record defining one more own key, whatever its name. */
function withKey<T>(
  record: Record<string, T>,
  key: string,
  value: T
): Record<string, T> {
  const copy = { ...record };
  Object.defineProperty(copy, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
  return copy;
}

/**
 * One value over another: the over value wins where it sets something, and a
 * composite is merged side by side, since one side may be set over four.
 */
function overlayValue(
  under: StyleValue | undefined,
  over: StyleValue | undefined
): StyleValue | undefined {
  if (over === undefined) return under;
  if (!isComposite(under) || !isComposite(over)) return over;
  let merged: Record<string, StyleValue> = { ...under };
  for (const [key, value] of ownEntries<StyleValue>(over)) {
    const next = overlayValue(
      Object.hasOwn(under, key) ? under[key] : undefined,
      value
    );
    if (next !== undefined) merged = withKey(merged, key, next);
  }
  return merged;
}

/** One breakpoint's values with another's laid over them, property by property. */
function overlaidValues(
  under: Record<string, StyleValue>,
  over: object
): Record<string, StyleValue> {
  let merged = under;
  for (const [property, value] of ownEntries<StyleValue>(over)) {
    const next = overlayValue(
      Object.hasOwn(merged, property) ? merged[property] : undefined,
      value
    );
    if (next !== undefined) merged = withKey(merged, property, next);
  }
  return merged;
}

/** One state's breakpoints with another's laid over them. */
function overlaidBreakpoints(
  under: Record<string, Record<string, StyleValue>>,
  over: object
): Record<string, Record<string, StyleValue>> {
  let merged = under;
  for (const [breakpoint, values] of ownEntries<object>(over)) {
    if (!isPlainRecord(values)) continue;
    const set = Object.hasOwn(merged, breakpoint) ? merged[breakpoint] : {};
    merged = withKey(merged, breakpoint, overlaidValues(set, values));
  }
  return merged;
}

/** The under envelope with the over one laid on it, at every state, breakpoint and property. *
 * @experimental
 */
export function overlaidStyles(
  under: NodeStyles | undefined,
  over: NodeStyles | undefined
): NodeStyles {
  let merged: Record<string, Record<string, Record<string, StyleValue>>> = {};
  for (const source of [under, over]) {
    for (const [state, byBreakpoint] of ownEntries<object>(source)) {
      // A malformed state holds nothing to lay over, and adds no empty tier.
      if (!isPlainRecord(byBreakpoint)) continue;
      const states = Object.hasOwn(merged, state) ? merged[state] : {};
      const laid = overlaidBreakpoints(states, byBreakpoint);
      if (Object.keys(laid).length > 0) merged = withKey(merged, state, laid);
    }
  }
  return merged;
}
