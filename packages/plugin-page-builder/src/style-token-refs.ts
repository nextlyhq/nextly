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
 * A value can also name a variable inside its CSS text, as `var()` of the
 * custom property the variable is written under: a shadow keeps its colour
 * that way, since its stored form stays CSS text, and an author may type
 * one into any value. Those are walked apart ({@link collectStyleProperties}),
 * by the custom property they name, since the identity behind one depends on
 * the site's prefix, which a stored value does not carry. Only the usage
 * index and the in-use checks read them: an export carries the variables a
 * document's `$token` references name, and a write is refused only for a
 * `$token` naming no variable, so neither reads a `var()`.
 *
 * @module style-token-refs
 */
import {
  customPropertiesReferenced,
  isTokenRef,
} from "@nextlyhq/blocks-engine";

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

/**
 * Every custom property a style value's CSS text reads through `var()`,
 * structured values included, by the engine's one walk of a value (names
 * read decoded, fallbacks included). Text with no `(` holds no function, so
 * it is not parsed: an escaped parenthesis opens none. A value the walk
 * cannot read whole is one the compiler does not emit, so it names nothing.
 */
export function collectStyleProperties(
  value: unknown,
  into: Set<string>
): void {
  if (typeof value === "string") {
    if (!value.includes("(")) return;
    for (const name of customPropertiesReferenced(value) ?? []) into.add(name);
    return;
  }
  if (isTokenRef(value) || !isRecord(value)) return;
  for (const inner of Object.values(value)) collectStyleProperties(inner, into);
}

/** Every custom property a whole style envelope's CSS text reads, likewise. */
export function styleEnvelopeProperties(
  styles: unknown,
  into: Set<string>
): void {
  forEachStyleValues(styles, (_breakpoint, values) =>
    collectStyleProperties(values, into)
  );
}
