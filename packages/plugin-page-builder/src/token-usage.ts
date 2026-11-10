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
 * @module token-usage
 */
import {
  MAX_TOKEN_NAME_LENGTH,
  blockLabelFrom,
  isPlainRecord,
  selectNodes,
  type DocumentLimits,
} from "@nextlyhq/blocks-engine";

import { readStoredJson } from "./stored-json";
import { collectStyleTokens, styleEnvelopeTokens } from "./style-token-refs";
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
  /** The variable identities the document uses, sorted, without repeats. */
  ids: string[];
  /**
   * Whether the whole document was read. False when a bound ended the node
   * selection early, so `ids` is a SUBSET and an absence proves nothing.
   */
  complete: boolean;
  /**
   * How many blocks use each variable, by identity: a block counts once
   * however many of its values name it. A variable used only by the
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
    return { ids: [], complete: true, blocks: new Map() };
  }
  // The compiler's own selection, so a variable on a node the stylesheet
  // writes rules for is never missed, and a bound that ends it says so.
  const selection = selectNodes(document, limits);
  const blocks = new Map<string, number>();
  for (const entry of selection.nodes) {
    const styles: unknown = (entry.node as { styles?: unknown }).styles;
    for (const identity of variablesIn(styles)) {
      blocks.set(identity, (blocks.get(identity) ?? 0) + 1);
    }
  }
  const ids = new Set(blocks.keys());
  const settings = document.settings;
  if (isPlainRecord(settings)) {
    for (const identity of variablesIn(settings.styles)) ids.add(identity);
  }
  return {
    ids: [...ids].sort(),
    complete: selection.stopped === undefined,
    blocks,
  };
}

/**
 * The shared styles whose own styles name each variable asked about, by
 * identity: a shared style's reference is a use whether or not any block
 * applies the style, since removing the variable changes the style.
 *
 * Takes the site style's classes as merged (the code's and the stored ones),
 * as stored values: each entry's `styles` is walked like a node's.
 */
export function sharedStylesUsing(
  classes: readonly unknown[],
  identities: ReadonlySet<string>
): ReadonlyMap<string, readonly { id: string; name: string }[]> {
  const using = new Map<string, { id: string; name: string }[]>();
  for (const entry of classes) {
    if (!isPlainRecord(entry) || typeof entry.id !== "string") continue;
    const style = { id: entry.id, name: classNameOf(entry) };
    for (const identity of sharedStyleVariables(entry)) {
      if (!identities.has(identity)) continue;
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
function blockDefaultVariables(block: BlockTypeDefaults): Set<string> {
  const found = new Set<string>();
  styleEnvelopeTokens(block.baseStyles, found);
  if (isPlainRecord(block.parts)) {
    for (const part of Object.values(block.parts)) {
      if (isPlainRecord(part)) styleEnvelopeTokens(part.baseStyles, found);
    }
  }
  collectStyleTokens(block.childGap, found);
  return onlyVariables(found);
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
  identities: ReadonlySet<string>
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
    for (const identity of blockDefaultVariables(block)) {
      if (!identities.has(identity)) continue;
      using.set(identity, [...(using.get(identity) ?? []), named]);
    }
  }
  return using;
}

/** The variables one stored shared style's own styles name. */
export function sharedStyleVariables(
  entry: Readonly<Record<string, unknown>>
): Set<string> {
  return variablesIn(entry.styles);
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
  derive: (document, limits) => tokenUsageOf(document, limits),
};
