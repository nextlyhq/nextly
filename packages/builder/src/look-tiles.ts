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
  isLook,
  isPlainRecord,
  isTokenRef,
  type NamedClass,
  type NodeStyles,
  type SiteTokenSet,
  type StyleValue,
  type TokenMode,
} from "@nextlyhq/blocks-engine";

import { classDeclarations } from "./class-library";

/** One tile: a look of the block's type, or the block's own (`id: null`). */
export interface LookTile {
  /** The look's class id, or `null` for the block's own look. */
  readonly id: string | null;
  readonly name: string;
  /** The look's own styles, laid over the block's base for the tile. */
  readonly styles: NodeStyles | undefined;
}

/** The looks a block of this type may wear, in library order. */
export function looksOfType(
  library: readonly NamedClass[],
  blockType: string
): NamedClass[] {
  return library
    .filter(entry => isLook(entry) && entry.blockType === blockType)
    .sort((a, b) => a.orderIndex - b.orderIndex);
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
      name: look.label ?? look.slug,
      styles: look.styles,
    })),
  ];
}

/** The look a block wears among these, or `null` for its own look. */
export function wornLook(
  classes: readonly string[] | undefined,
  looks: readonly NamedClass[]
): string | null {
  const ids = new Set(looks.map(look => look.id));
  return (classes ?? []).find(id => ids.has(id)) ?? null;
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

/** A token reference's value in one mode, or the reference left as it is. */
function tokenValue(
  ref: { readonly $token: string },
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): StyleValue {
  const token = tokens?.tokens.find(
    each => (each.id ?? each.name) === ref.$token || each.name === ref.$token
  );
  const value = token?.values[mode] ?? token?.values.light;
  return value === undefined ? (ref as StyleValue) : (value as StyleValue);
}

/** A value with every token it names resolved for one mode. */
function resolved(
  value: unknown,
  tokens: SiteTokenSet | undefined,
  mode: TokenMode
): unknown {
  if (isTokenRef(value as StyleValue)) {
    return tokenValue(value as { $token: string }, tokens, mode);
  }
  if (!isPlainRecord(value)) return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, inner]) => [
      key,
      resolved(inner, tokens, mode),
    ])
  );
}

/** The CSS properties a tile draws, as React spells them. */
const TILE_PROPERTIES: Readonly<Record<string, string>> = {
  color: "color",
  "background-color": "backgroundColor",
  "border-top-width": "borderTopWidth",
  "border-right-width": "borderRightWidth",
  "border-bottom-width": "borderBottomWidth",
  "border-left-width": "borderLeftWidth",
  "border-top-style": "borderTopStyle",
  "border-right-style": "borderRightStyle",
  "border-bottom-style": "borderBottomStyle",
  "border-left-style": "borderLeftStyle",
  "border-top-color": "borderTopColor",
  "border-right-color": "borderRightColor",
  "border-bottom-color": "borderBottomColor",
  "border-left-color": "borderLeftColor",
  "border-radius": "borderRadius",
  "border-top-left-radius": "borderTopLeftRadius",
  "border-top-right-radius": "borderTopRightRadius",
  "border-bottom-right-radius": "borderBottomRightRadius",
  "border-bottom-left-radius": "borderBottomLeftRadius",
  "text-decoration-line": "textDecorationLine",
  "text-decoration": "textDecoration",
  "aspect-ratio": "aspectRatio",
  "font-weight": "fontWeight",
};

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
  for (const source of [base, look]) {
    if (source === undefined) continue;
    const literal = resolved(source, tokens, mode) as NodeStyles;
    for (const entry of classDeclarations(literal).shown) {
      const key = Object.hasOwn(TILE_PROPERTIES, entry.property)
        ? TILE_PROPERTIES[entry.property]
        : undefined;
      if (key === undefined || entry.descendant !== undefined) continue;
      // A value still naming a variable has nothing to resolve against here.
      if (/\b(?:var|url)\(/i.test(entry.value)) continue;
      style[key] = entry.value;
    }
  }
  return style;
}
