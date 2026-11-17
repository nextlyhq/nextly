/**
 * Which variables (design tokens) a style envelope and a whole document name.
 *
 * The one walk over a style's `$token` references. An export reads it to
 * carry the variables a document needs, the variable usage index reads it to
 * record which documents and shared styles use each variable, and the editor
 * reads it for the open page, so none of them can disagree about what counts
 * as a reference.
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
 * the site's prefix, which a stored value does not carry.
 *
 * @module document-token-usage
 */
import { isTokenRef } from "../document-styles";
import type { DocumentLimits } from "../limits";
import { isPlainRecord } from "../plain-record";
import { selectNodes } from "../select-nodes";

import { contentWidthTokenOf } from "./content-width";
import { customPropertiesReferenced } from "./css-value-check";
import { MAX_TOKEN_NAME_LENGTH, MAX_TOKEN_PREFIX_LENGTH } from "./declarations";

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

/** What a stored document says about the variables it uses. */
export interface TokenUsage {
  /**
   * The variable identities the document's `$token` references name, sorted,
   * without repeats: what a write naming a variable the site lacks is judged
   * by (`token-reference-judgement`).
   */
  ids: string[];
  /**
   * The custom properties the document's CSS text reads through `var()` that
   * a site variable could be written under ({@link namesASiteProperty}),
   * sorted, without repeats. Not in `ids`: which variable one names depends
   * on the site's prefix, and a `var()` naming none is CSS the author typed,
   * never a reference to refuse.
   */
  properties: string[];
  /**
   * Whether the whole document was read. False when a bound ended the node
   * selection early, so `ids` is a SUBSET and an absence proves nothing.
   */
  complete: boolean;
  /**
   * How many blocks use each variable through `$token`, by identity: a block
   * counts once however many of its values name it. A variable used only by the
   * document's own `settings.styles` is in `ids` and absent here, since no
   * block uses it. A Map, so an identity such as `__proto__` is a key like
   * any other.
   */
  blocks: ReadonlyMap<string, number>;
}

/**
 * Whether a stored reference can name a variable the site could write.
 * Longer identities are never emitted, so they use nothing, and skipping them
 * is what keeps the usage index's longer marker identity disjoint from
 * every reference.
 */
function namesAVariable(identity: string): boolean {
  return identity.length <= MAX_TOKEN_NAME_LENGTH;
}

/** The identities in `found` that can name a variable at all. */
export function onlyVariableIdentities(found: Set<string>): Set<string> {
  for (const identity of found) {
    if (!namesAVariable(identity)) found.delete(identity);
  }
  return found;
}

/** The variables one style envelope names that can name a variable at all. */
export function styleVariablesIn(styles: unknown): Set<string> {
  const found = new Set<string>();
  styleEnvelopeTokens(styles, found);
  return onlyVariableIdentities(found);
}

/**
 * The longest custom property a site writes a variable under: the longest
 * prefix the engine accepts and the longest identity it writes.
 */
const MAX_SITE_PROPERTY_LENGTH =
  MAX_TOKEN_PREFIX_LENGTH + MAX_TOKEN_NAME_LENGTH;

/**
 * The alphabet of every custom property a site writes a variable under: a
 * prefix is `--` then lowercase letters, digits and dashes (`safeTokenPrefix`),
 * and an identity's dots are written as dashes (`tokenCustomProperty`).
 */
const SITE_PROPERTY = /^--[a-z0-9-]+$/;

/**
 * Whether a custom property is one a site variable could be written under:
 * any other names no variable on any site, so it uses nothing. Length first,
 * so the pattern never scans an oversized name.
 */
function namesASiteProperty(property: string): boolean {
  return (
    property.length <= MAX_SITE_PROPERTY_LENGTH && SITE_PROPERTY.test(property)
  );
}

/** The properties in `found` a site variable could be written under. */
export function onlySiteProperties(found: Set<string>): Set<string> {
  for (const property of found) {
    if (!namesASiteProperty(property)) found.delete(property);
  }
  return found;
}

/** The site properties one style envelope's CSS text reads through `var()`. */
export function styleSitePropertiesIn(styles: unknown): Set<string> {
  const found = new Set<string>();
  styleEnvelopeProperties(styles, found);
  return onlySiteProperties(found);
}

/** Add each of `from` to `into`. */
function addEach(into: Set<string>, from: Iterable<string>): void {
  for (const value of from) into.add(value);
}

/**
 * The variables one node names through `$token`: in its styles, and as its
 * own content width, a prop the compiler writes from, so a variable it
 * names is used as one in the styles is.
 */
function nodeVariables(node: unknown, styles: unknown): Set<string> {
  const found = styleVariablesIn(styles);
  const ownWidth = contentWidthTokenOf(node);
  if (ownWidth !== undefined && namesAVariable(ownWidth)) found.add(ownWidth);
  return found;
}

/**
 * The variables a document uses, and whether it could all be read: the
 * usage index reads a stored document with it, and the editor the open one,
 * so the two count a variable as used by the same rule.
 *
 * Total by construction: a document may arrive unvalidated, and a shape this
 * cannot read contributes nothing rather than raising. `limits` is required,
 * as the component reader's is: a caller reads under the bounds the page is
 * drawn with.
 */
export function documentTokenUsage(
  document: unknown,
  limits: DocumentLimits
): TokenUsage {
  if (!isPlainRecord(document) || !Array.isArray(document.nodes)) {
    return { ids: [], properties: [], complete: true, blocks: new Map() };
  }
  // The compiler's own selection, so a variable on a node the stylesheet
  // writes rules for is never missed, and a bound that ends it says so.
  const selection = selectNodes(document, limits);
  const blocks = new Map<string, number>();
  const properties = new Set<string>();
  for (const entry of selection.nodes) {
    const styles: unknown = (entry.node as { styles?: unknown }).styles;
    addEach(properties, styleSitePropertiesIn(styles));
    for (const identity of nodeVariables(entry.node, styles)) {
      blocks.set(identity, (blocks.get(identity) ?? 0) + 1);
    }
  }
  const ids = new Set(blocks.keys());
  // The document's own styles, which the compiler emits as well.
  const settings = isPlainRecord(document.settings)
    ? document.settings.styles
    : undefined;
  addEach(ids, styleVariablesIn(settings));
  addEach(properties, styleSitePropertiesIn(settings));
  return {
    ids: [...ids].sort(),
    properties: [...properties].sort(),
    complete: selection.stopped === undefined,
    blocks,
  };
}
