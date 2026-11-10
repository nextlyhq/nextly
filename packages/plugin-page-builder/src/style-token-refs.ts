/**
 * Which variables (design tokens) a style envelope names.
 *
 * The one walk over a style's `$token` references. An export reads it to
 * carry the variables a document needs, and the variable usage index reads it
 * to record which documents and shared styles use each variable, so the two
 * can never disagree about what counts as a reference.
 *
 * An envelope is states, then breakpoints, then the values set there
 * (`NodeStyles`); a value is a scalar, a `$token` reference, or a structured
 * value whose members are values again. A reference is recorded by the string
 * it stores, which is the variable's identity (`tokenIdentity`: its `id`,
 * else its name).
 *
 * @module style-token-refs
 */
import { isTokenRef } from "@nextlyhq/blocks-engine";

/** Whether a value is a record a walk may descend into. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Visit each breakpoint's values of a style envelope, under every state.
 * Anything that is not an envelope visits nothing.
 */
export function forEachStyleValues(
  styles: unknown,
  visit: (breakpoint: string, values: unknown) => void
): void {
  if (!isRecord(styles)) return;
  for (const byBreakpoint of Object.values(styles)) {
    if (!isRecord(byBreakpoint)) continue;
    for (const [breakpoint, values] of Object.entries(byBreakpoint)) {
      visit(breakpoint, values);
    }
  }
}

/** Every `$token` inside a style value, structured values included. */
export function collectStyleTokens(value: unknown, into: Set<string>): void {
  if (isTokenRef(value)) {
    into.add(value.$token);
    return;
  }
  if (!isRecord(value)) return;
  for (const inner of Object.values(value)) collectStyleTokens(inner, into);
}

/** Every `$token` a whole style envelope names, under every state and breakpoint. */
export function styleEnvelopeTokens(styles: unknown, into: Set<string>): void {
  forEachStyleValues(styles, (_breakpoint, values) =>
    collectStyleTokens(values, into)
  );
}
