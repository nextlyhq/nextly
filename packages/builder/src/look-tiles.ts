/**
 * A block's looks, as the Style tab offers them as tiles: which looks its
 * type has, which one it wears, what wearing another means for its classes,
 * and how a tile draws each one.
 *
 * A look is a shared style bound to one block type (`NamedClass.blockType`).
 * The block's own look, its base styles, is wearing none of them. A block
 * wears at most one look, beside at most one shared style.
 *
 * @module look-tiles
 */

import {
  MAX_CLASSES_PER_NODE,
  isLook,
  isPlainRecord,
  isTokenRef,
  resolveSiteTokens,
  scaledTokenText,
  tokenIdentity,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type StyleValue,
  type TokenMode,
  type TokenRef,
} from "@nextlyhq/blocks-engine";

import { classDeclarations, usableSiteClasses } from "./class-library";
import { sharedStyleName } from "./shared-style-library";

/** One tile: a look of the block's type, or the block's own (`id: null`). */
export interface LookTile {
  /** The look's class id, or `null` for the block's own look. */
  readonly id: string | null;
  readonly name: string;
  /** The look's own styles, laid over the block's base for the tile. */
  readonly styles: NodeStyles | undefined;
}

/**
 * The looks a block of this type may wear, in library order: those the
 * compiler renders, read from the same view the class picker reads, so a
 * look whose name a site's own style holds is not offered.
 */
export function looksOfType(
  library: readonly NamedClass[],
  blockType: string
): NamedClass[] {
  return usableSiteClasses(library).filter(
    entry => isLook(entry) && entry.blockType === blockType
  );
}

/**
 * Every look bound to this block type, offered or not: what choosing a tile
 * takes off, so a look a site's style hides now cannot return beside the
 * chosen one when that style goes.
 */
export function boundLooksOf(
  library: readonly NamedClass[],
  blockType: string
): NamedClass[] {
  // An id a rendering shared style holds is that style's, as the engine gives
  // it: never taken off as though it were the look that lost it.
  const styles = new Set(
    usableSiteClasses(library)
      .filter(entry => !isLook(entry))
      .map(entry => entry.id)
  );
  return library.filter(
    entry =>
      isLook(entry) && entry.blockType === blockType && !styles.has(entry.id)
  );
}

/**
 * The tiles for a block: its own look first, named as its definition names
 * it, then its type's looks. No tiles when the type has no looks: a row of
 * one tile would offer a choice that isn't there.
 */
export function lookTiles(
  library: readonly NamedClass[],
  blockType: string,
  ownName: string | undefined
): LookTile[] {
  const looks = looksOfType(library, blockType);
  if (looks.length === 0) return [];
  return [
    { id: null, name: ownName ?? "Default", styles: undefined },
    ...looks.map(look => ({
      id: look.id,
      name: sharedStyleName(look),
      styles: look.styles,
    })),
  ];
}

/**
 * The look a block wears among these, or `null` for its own look. A block
 * listing more than one (stored or imported that way) shows the one written
 * last, in library order, as the canvas does; choosing a tile leaves one.
 */
export function wornLook(
  classes: readonly string[] | undefined,
  looks: readonly NamedClass[]
): string | null {
  // Only the references the engine reads: past the per-node cap, a look is
  // listed but never applied.
  const listed = new Set((classes ?? []).slice(0, MAX_CLASSES_PER_NODE));
  const worn = looks.filter(look => listed.has(look.id));
  return worn.at(-1)?.id ?? null;
}

/**
 * A block's classes wearing another look: every look of its type taken off,
 * then the chosen one added (none for the block's own look). Its shared
 * style, and anything else it lists, are kept as they are.
 */
export function withLook(
  classes: readonly string[] | undefined,
  looks: readonly NamedClass[],
  id: string | null
): string[] {
  const ids = new Set(looks.map(look => look.id));
  const kept = (classes ?? []).filter(each => !ids.has(each));
  return id === null ? kept : [id, ...kept];
}

/**
 * What choosing a tile does to a block's classes: nothing, when they would
 * stay as they are (the no-op is the stored list's, not the visible tiles',
 * so a hidden look still comes off); a refusal, when the new list would pass
 * the classes the engine reads per node; else the classes to store.
 */
export function lookChoice(
  classes: readonly string[] | undefined,
  removable: readonly NamedClass[],
  id: string | null
):
  | { readonly kind: "unchanged" }
  | { readonly kind: "full" }
  | { readonly kind: "apply"; readonly classes: string[] } {
  const current = classes ?? [];
  const next = withLook(current, removable, id);
  if (
    next.length === current.length &&
    next.every((each, index) => each === current[index])
  ) {
    return { kind: "unchanged" };
  }
  if (next.length > MAX_CLASSES_PER_NODE) return { kind: "full" };
  return { kind: "apply", classes: next };
}

/**
 * A token reference's value in one mode, at the reference's factor as the
 * page compiles it, or the reference left as it is.
 */
function tokenValue(
  ref: TokenRef,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): StyleValue {
  // By identity alone, as the canvas declares a token: a renamed token's
  // old display name resolves nothing there, so it resolves nothing here.
  const token = tokens?.tokens.find(each => tokenIdentity(each) === ref.$token);
  const value = token?.values[mode] ?? token?.values.light;
  if (value === undefined) return ref;
  // A number at its factor is the number the page's `calc()` computes; text
  // takes the page's own spelling of the scale.
  if (typeof value === "number") {
    return typeof ref.times === "number" ? value * ref.times : value;
  }
  return typeof value === "string" ? scaledTokenText(value, ref.times) : value;
}

/** A value with every token it names resolved for one mode. */
function resolved(
  value: unknown,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): unknown {
  if (isTokenRef(value)) {
    return tokenValue(value, tokens, mode);
  }
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      resolved(inner, tokens, mode),
    ])
  );
}

/**
 * Whether a tile draws this CSS property: what a small specimen can show
 * (colour, border, corners, decoration, proportion). The engine writes
 * logical properties (`border-block-start-width`), so borders are matched by
 * family rather than listed; sizes stay the tile's own.
 */
function drawnOnTile(property: string): boolean {
  return (
    property === "color" ||
    property === "background-color" ||
    property === "aspect-ratio" ||
    property === "object-fit" ||
    property === "font-weight" ||
    property.startsWith("border") ||
    property.startsWith("text-decoration")
  );
}

/** A CSS property as React spells it: `border-block-start-width` → `borderBlockStartWidth`. */
function reactProperty(property: string): string {
  return property.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}

/**
 * How a tile draws a look: the block's base with the look laid over, its
 * tokens resolved for the mode the canvas shows, as inline styles. Only the
 * properties a small specimen can show (colour, border, corners, decoration,
 * proportion); sizes stay the tile's own, so every tile is the same size.
 */
export function lookTileStyle(
  base: NodeStyles | undefined,
  look: NodeStyles | undefined,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): Record<string, string> {
  const style: Record<string, string> = {};
  // The site's tokens over the defaults, as the canvas compiles with them.
  const set = resolveSiteTokens(tokens);
  for (const source of [base, look]) {
    if (source === undefined) continue;
    const literal = resolved(source, set, mode) as NodeStyles;
    for (const entry of classDeclarations(literal).shown) {
      if (!drawnOnTile(entry.property) || entry.descendant !== undefined) {
        continue;
      }
      // A value still naming a variable has nothing to resolve against here.
      if (/\b(?:var|url)\(/i.test(entry.value)) continue;
      style[reactProperty(entry.property)] = entry.value;
    }
  }
  return style;
}

/**
 * What the bar says about a look the block wears while the block is the
 * target: that an edit here changes this block only, and how to change the
 * look itself for every block wearing it. No count: what the site knows is
 * which documents an index records, not how many blocks wear the look, and a
 * count of this page's blocks beside "every" would read as the site's.
 */
export function lookLineWords(
  lookName: string,
  blockLabel: string
): { here: string; everywhere: string } {
  const block = blockLabel.toLowerCase();
  return {
    here: `Changes this ${block} only`,
    everywhere: `Edit ${lookName} for every ${block} that uses it`,
  };
}
