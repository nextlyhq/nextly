/**
 * Which variables (design tokens) a stored document uses, and the variable
 * usage index built from that answer.
 *
 * The variable half of what `class-usage.ts` answers for named classes, and
 * the same two-valued shape for the same reason: the record decides whether a
 * variable may be REMOVED, a removal reads absence as evidence, and an
 * absence produced by a bound rather than by the document must be visible.
 *
 * ## What it reads
 *
 * The `$token` references in the styles of exactly the nodes the compiler
 * reads (`selectNodes` under the page's bounds, gated and hidden nodes
 * included, as the class reader selects them), and in the document's own
 * `settings.styles`, which the compiler emits as well. Each style value is
 * walked by `style-token-refs`, the walk an export carries variables by. A
 * variable named only inside a shared style is the shared style's use, read
 * from the site style rather than from any document; one named by a block
 * type's own default styles (`baseStyles`) is that block type's, read from
 * the block registry.
 *
 * ## A variable named in CSS text
 *
 * A value can name a variable as `var()` of the custom property it is written
 * under (a shadow's colour is kept that way). Which variable that is depends
 * on the site's prefix, which a stored document does not carry, and two
 * identities can map to one property (`tokenCustomProperty`), so the
 * property is recorded as it is, under its own key ({@link propertyUsageKey}),
 * and never mapped back. A question about a variable asks for its identity
 * and for the key of the property it is written under on this site
 * ({@link variablesAsked}), and folds the answers back to it, wherever the
 * question is asked from.
 *
 * @module token-usage
 */
import {
  MAX_TOKEN_NAME_LENGTH,
  MAX_TOKEN_PREFIX_LENGTH,
  blockLabelFrom,
  contentWidthTokenOf,
  isPlainRecord,
  isTokenName,
  resolveTokenPrefix,
  selectNodes,
  tokenCustomProperty,
  tokenDisplayLabel,
  tokenIdentity,
  type DocumentLimits,
  type SiteTokenSet,
} from "@nextlyhq/blocks-engine";

import { readStoredJson } from "./stored-json";
import {
  collectStyleProperties,
  collectStyleTokens,
  styleEnvelopeProperties,
  styleEnvelopeTokens,
} from "./style-token-refs";
import type { UsageIndex, UsageSubject } from "./usage-index";

/** One row: this document, through this field, uses this variable. */
export type TokenUsageRow = UsageSubject & {
  /**
   * The variable's identity as the document stores it in `$token` (the
   * token's `id`, else its name), or the marker {@link UNDETERMINED_TOKEN_ID}
   * on the row recording that the document could not be read whole: disjoint
   * by length, since the derivation records no identity that long.
   */
  tokenId: string;
};

/**
 * The identity a marker row carries, chosen so no real reference can wear it.
 *
 * Disjoint by LENGTH, as the class marker is: the engine writes no token whose
 * identity is longer than `MAX_TOKEN_NAME_LENGTH` (`tokenNamingProblem`), and
 * {@link tokenUsageOf} records no reference longer than that, so this value can
 * name no variable a caller could ask about. A test asserts the engine refuses
 * it as an identity, so a change to that rule fails rather than collides.
 */
export const UNDETERMINED_TOKEN_ID: string = `undetermined:${"-".repeat(
  MAX_TOKEN_NAME_LENGTH
)}`;

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
 * is what keeps {@link UNDETERMINED_TOKEN_ID} disjoint from every reference.
 */
function namesAVariable(identity: string): boolean {
  return identity.length <= MAX_TOKEN_NAME_LENGTH;
}

/** The identities in `found` that can name a variable at all. */
function onlyVariables(found: Set<string>): Set<string> {
  for (const identity of found) {
    if (!namesAVariable(identity)) found.delete(identity);
  }
  return found;
}

/** The variables one style envelope names that can name a variable at all. */
function variablesIn(styles: unknown): Set<string> {
  const found = new Set<string>();
  styleEnvelopeTokens(styles, found);
  return onlyVariables(found);
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
function onlySiteProperties(found: Set<string>): Set<string> {
  for (const property of found) {
    if (!namesASiteProperty(property)) found.delete(property);
  }
  return found;
}

/** The site properties one style envelope's CSS text reads through `var()`. */
function propertiesIn(styles: unknown): Set<string> {
  const found = new Set<string>();
  styleEnvelopeProperties(styles, found);
  return onlySiteProperties(found);
}

/**
 * What marks a usage key as a custom property rather than an identity: a
 * colon, which the token name grammar (`isTokenName`) never holds, so no
 * identity can wear one. The undetermined marker starts otherwise, so it is
 * disjoint from these too.
 */
const PROPERTY_KEY_MARK = "var:";

/**
 * The usage key a custom property read through `var()` is recorded under,
 * disjoint from every identity by {@link PROPERTY_KEY_MARK}.
 */
function propertyUsageKey(property: string): string {
  return `${PROPERTY_KEY_MARK}${property}`;
}

/**
 * Every usage key a reading records: each identity a variable can have, and
 * each property under its own key. An identity outside the name grammar is
 * none a site can define, and leaving it out keeps the two kinds of key
 * disjoint: a stored `$token` spelled like a property's key names nothing.
 */
export function usageKeysOf(
  usage: Pick<TokenUsage, "ids" | "properties">
): string[] {
  return [
    ...usage.ids.filter(identity => isTokenName(identity)),
    ...usage.properties.map(propertyUsageKey),
  ];
}

/**
 * Whether a usage key is an identity rather than a custom property's key
 * ({@link propertyUsageKey}).
 */
export function isIdentityKey(key: string): boolean {
  return !key.startsWith(PROPERTY_KEY_MARK);
}

/**
 * The key of every site property any string anywhere in a stored value
 * reads through `var()`, whatever field holds it: what a page the index does
 * not cover is read for (`uncovered-pages`), where no walk of its blocks can
 * be made. A string holding stored JSON (SQLite hands a JSON column back as
 * text) is read as the value it holds.
 *
 * Walked with a list rather than by recursion, since such a page can be
 * nested past any depth a recursive walk survives. Every string counts, so
 * a `var()` in text that is no style is a use too: this errs towards
 * refusing a removal, never towards allowing one.
 */
export function propertyKeysAnywhere(value: unknown): Set<string> {
  const properties = new Set<string>();
  const pending: unknown[] = [value];
  while (pending.length > 0) {
    // Pushed one at a time: spreading a very long list into one call can
    // exceed the engine's argument limit.
    for (const item of storedChildren(pending.pop(), properties)) {
      pending.push(item);
    }
  }
  return new Set(
    usageKeysOf({ ids: [], properties: [...onlySiteProperties(properties)] })
  );
}

/**
 * What a stored value holds for {@link propertyKeysAnywhere} to read next: a
 * list's items, a record's values, or the value stored JSON text holds. Any
 * other string is read for its properties into `properties` here.
 */
function storedChildren(
  value: unknown,
  properties: Set<string>
): readonly unknown[] {
  if (Array.isArray(value)) return value;
  if (isPlainRecord(value)) return Object.values(value);
  if (typeof value !== "string") return [];
  const held = /^\s*[[{]/.test(value) ? readStoredJson(value) : undefined;
  if (typeof held === "object" && held !== null) return [held];
  collectStyleProperties(value, properties);
  return [];
}

/** Every usage key one stored style envelope records, likewise. */
function styleUsageKeys(styles: unknown): Set<string> {
  return new Set(
    usageKeysOf({
      ids: [...variablesIn(styles)],
      properties: [...propertiesIn(styles)],
    })
  );
}

/**
 * A question about some variables, as this site writes them: each one's
 * identity and the key of the custom property it is written under.
 */
export interface VariablesAsked {
  /** Every key asked for, identities and properties alike, without repeats. */
  readonly keys: readonly string[];
  /** The identities asked about that any of the keys `found` answers for. */
  identitiesIn(found: Iterable<string>): Set<string>;
}

/**
 * The one way a question about variables is asked: each identity, with the
 * key of the custom property it is written under on a site whose token
 * prefix is `prefix` (as stored; refused or absent, the default). Two
 * identities written under one property both answer to its key, so a
 * reference to it uses both: either may be the one it resolves to.
 */
export function variablesAsked(
  identities: Iterable<string>,
  prefix: string | undefined
): VariablesAsked {
  const written = resolveTokenPrefix(prefix).prefix;
  const askedBy = new Map<string, string[]>();
  for (const identity of new Set(identities)) {
    const keys = [
      identity,
      propertyUsageKey(tokenCustomProperty(identity, written)),
    ];
    for (const key of keys) {
      askedBy.set(key, [...(askedBy.get(key) ?? []), identity]);
    }
  }
  return {
    keys: [...askedBy.keys()],
    identitiesIn: found => {
      const identities = new Set<string>();
      for (const key of found) {
        for (const identity of askedBy.get(key) ?? []) identities.add(identity);
      }
      return identities;
    },
  };
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
  const found = variablesIn(styles);
  const ownWidth = contentWidthTokenOf(node);
  if (ownWidth !== undefined && namesAVariable(ownWidth)) found.add(ownWidth);
  return found;
}

/**
 * The variables a stored document uses, and whether it could all be read.
 *
 * Total by construction: persisted data arrives unvalidated, and a shape this
 * cannot read contributes nothing rather than raising. `limits` is required,
 * as the component reader's is: the caller is the index, which must read
 * under the bounds the page is drawn with.
 */
export function tokenUsageOf(
  stored: unknown,
  limits: DocumentLimits
): TokenUsage {
  const document = readStoredJson(stored);
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
    addEach(properties, propertiesIn(styles));
    for (const identity of nodeVariables(entry.node, styles)) {
      blocks.set(identity, (blocks.get(identity) ?? 0) + 1);
    }
  }
  const ids = new Set(blocks.keys());
  // The document's own styles, which the compiler emits as well.
  const settings = isPlainRecord(document.settings)
    ? document.settings.styles
    : undefined;
  addEach(ids, variablesIn(settings));
  addEach(properties, propertiesIn(settings));
  return {
    ids: [...ids].sort(),
    properties: [...properties].sort(),
    complete: selection.stopped === undefined,
    blocks,
  };
}

/** A shared style naming a variable: its id, its name, and a look's block type. */
export interface SharedStyleNaming {
  readonly id: string;
  readonly name: string;
  /** The block type a look is bound to; absent for a shared style. */
  readonly blockType?: string;
}

/**
 * The shared styles whose own styles name each variable asked about, by
 * identity: a shared style's reference is a use whether or not any block
 * applies the style, since removing the variable changes the style. A
 * reference is a `$token` or a `var()` of the property the variable is
 * written under ({@link variablesAsked}).
 *
 * Takes the site style's classes as merged (the code's and the stored ones),
 * as stored values: each entry's `styles` is walked like a node's.
 */
export function sharedStylesUsing(
  classes: readonly unknown[],
  asked: VariablesAsked
): ReadonlyMap<string, readonly SharedStyleNaming[]> {
  const using = new Map<string, SharedStyleNaming[]>();
  for (const entry of classes) {
    if (!isPlainRecord(entry) || typeof entry.id !== "string") continue;
    // A look keeps its block type: two types' own looks may share an id, and
    // only the pair tells them apart. Each entry is its own style here.
    const style: SharedStyleNaming = {
      id: entry.id,
      name: classNameOf(entry),
      ...(typeof entry.blockType === "string"
        ? { blockType: entry.blockType }
        : {}),
    };
    for (const identity of asked.identitiesIn(styleUsageKeys(entry.styles))) {
      using.set(identity, [...(using.get(identity) ?? []), style]);
    }
  }
  return using;
}

/**
 * A registered block type, as far as the styles the compiler writes from its
 * definition go: its own default styles, each part's default styles, and the
 * space it puts between its children. Each read as stored, since a plugin's
 * definition reaches the compiler unvalidated by some paths.
 */
export interface BlockTypeDefaults {
  readonly name: string;
  readonly baseStyles?: unknown;
  readonly parts?: unknown;
  readonly childGap?: unknown;
  readonly editor?: { readonly label?: string };
}

/**
 * The variables a block type's definition names in any style the compiler
 * writes from it (`compilePageCss`'s block tier): the base envelope, each
 * part's base envelope, and the child gap, which is one style value rather
 * than an envelope. A block's looks are not read here: the site receives
 * them as shared styles, and they are counted there.
 */
function blockDefaultKeys(block: BlockTypeDefaults): Set<string> {
  const ids = new Set<string>();
  const properties = new Set<string>();
  const envelopes: unknown[] = [block.baseStyles];
  if (isPlainRecord(block.parts)) {
    for (const part of Object.values(block.parts)) {
      if (isPlainRecord(part)) envelopes.push(part.baseStyles);
    }
  }
  for (const styles of envelopes) {
    styleEnvelopeTokens(styles, ids);
    styleEnvelopeProperties(styles, properties);
  }
  collectStyleTokens(block.childGap, ids);
  collectStyleProperties(block.childGap, properties);
  return new Set(
    usageKeysOf({
      ids: [...onlyVariables(ids)],
      properties: [...onlySiteProperties(properties)],
    })
  );
}

/**
 * The registered block types whose own default styles name each variable
 * asked about, by identity, in type order: what the compiler writes from a
 * type's definition is laid under every instance of it on every page that
 * places one, so removing the variable changes all of them whether or not
 * any page does yet. Each type is named by the label the editor shows it by.
 */
export function blockDefaultsUsing(
  blocks: readonly BlockTypeDefaults[],
  asked: VariablesAsked
): ReadonlyMap<string, readonly { type: string; label: string }[]> {
  const using = new Map<string, { type: string; label: string }[]>();
  const sorted = [...blocks].sort((a, b) =>
    a.name < b.name ? -1 : a.name > b.name ? 1 : 0
  );
  for (const block of sorted) {
    const named = {
      type: block.name,
      label: blockLabelFrom(block.name, block),
    };
    for (const identity of asked.identitiesIn(blockDefaultKeys(block))) {
      using.set(identity, [...(using.get(identity) ?? []), named]);
    }
  }
  return using;
}

/** The variables one stored shared style's own styles name through `$token`. */
export function sharedStyleVariables(
  entry: Readonly<Record<string, unknown>>
): Set<string> {
  return variablesIn(entry.styles);
}

/** A variable naming another in its value: its identity and its name. */
export interface VariableNaming {
  readonly id: string;
  readonly name: string;
}

/**
 * The site's variables whose own values name each variable asked about
 * through `var()`, by identity, in the site's order: a shadow variable keeps
 * its colour that way, so removing the colour changes the shadow. Takes the
 * site's variables every tier merged (`resolveSiteTokens`), as the write
 * leaves them, so a variable removed with the one it names is not its use.
 * A variable's value naming its own property is not a use of itself.
 */
export function variablesUsing(
  tokens: SiteTokenSet,
  asked: VariablesAsked
): ReadonlyMap<string, readonly VariableNaming[]> {
  const using = new Map<string, VariableNaming[]>();
  for (const token of tokens.tokens) {
    const properties = new Set<string>();
    collectStyleProperties(token.values, properties);
    const keys = usageKeysOf({
      ids: [],
      properties: [...onlySiteProperties(properties)],
    });
    const naming = { id: tokenIdentity(token), name: tokenDisplayLabel(token) };
    for (const identity of asked.identitiesIn(keys)) {
      if (identity === naming.id) continue;
      using.set(identity, [...(using.get(identity) ?? []), naming]);
    }
  }
  return using;
}

/** The code a write adding a reference to a variable the site lacks is refused with. */
export const UNKNOWN_TOKEN_CODE = "unknown-token";

/** How many undefined variables one refusal names; the rest are counted. */
const NAMED_AT_MOST = 5;

/**
 * The words a write adding references to variables the site does not define
 * is refused with, `label` naming what was written and `from` where the
 * author removes them: one wording for a page and for a shared style.
 */
export function undefinedVariablesMessage(
  label: string,
  added: readonly string[],
  from: string
): string {
  const named = added
    .slice(0, NAMED_AT_MOST)
    .map(id => `"${id}"`)
    .join(", ");
  const more =
    added.length > NAMED_AT_MOST
      ? ` and ${added.length - NAMED_AT_MOST} more`
      : "";
  const one = added.length === 1;
  return `${label}: ${named}${more} ${one ? "is not a variable" : "are not variables"} on this site. Remove ${one ? "it" : "them"} from ${from}, or choose a variable the site has.`;
}

/** The name a shared style is shown by: its label, else its slug, else its id. */
function classNameOf(entry: Record<string, unknown>): string {
  if (typeof entry.label === "string" && entry.label.trim() !== "") {
    return entry.label;
  }
  if (typeof entry.slug === "string" && entry.slug !== "") return entry.slug;
  return String(entry.id);
}

/**
 * The variable index, as the shared machinery sees it. The row carries
 * nothing beside its reference, so every member is the class index's with
 * `tokenId` for `classId`, the marker disjoint by length as that one is.
 */
export const tokenUsageIndex: UsageIndex<TokenUsageRow> = {
  readOwn: item =>
    typeof item.tokenId === "string" ? { tokenId: item.tokenId } : null,
  // Nothing beside the reference, so the key IS the identity.
  reconcileKeyOf: row => row.tokenId,
  rowFor: (subject, referenceId) => ({ ...subject, tokenId: referenceId }),
  whereReferencing: referenceId => ({ tokenId: { equals: referenceId } }),
  whereReferencingAny: referenceIds => ({
    tokenId: { in: [...referenceIds] },
  }),
  referenceOf: own => own.tokenId,
  // Disjoint by length, so this never matches a question about a variable.
  whereUndetermined: () => ({ tokenId: { equals: UNDETERMINED_TOKEN_ID } }),
  markerFor: subject => ({ ...subject, tokenId: UNDETERMINED_TOKEN_ID }),
  isMarker: row => row.tokenId === UNDETERMINED_TOKEN_ID,
  // Each `$token` identity and each `var()` property under its own key,
  // which a question about a variable asks for together (`variablesAsked`).
  derive: (document, limits) => {
    const usage = tokenUsageOf(document, limits);
    return { ids: usageKeysOf(usage), complete: usage.complete };
  },
};
