/**
 * A block type's looks, as the shared styles a site receives.
 *
 * A look is one named variant of a block (a button's Outline, an image's
 * Circle), declared by the block in `editor.variations` with `styles`. The
 * site receives each one as a shared style bound to the block type, so the
 * same compiler, usage counts and locks that serve shared styles serve looks,
 * and a site may edit one in Design. Looks are written before every other
 * shared style (`isLook`), so a shared style and the block's own values
 * still win over a look.
 *
 * @module block-looks
 * @experimental
 */

import type { BlockVariation } from "../block";

import {
  isUsableNamedClass,
  MAX_NAMED_CLASS_NAME_LENGTH,
  NAMED_CLASS_SLUG_RE,
  type NamedClass,
} from "./named-class";

/** What a look reads from a block definition: its type and its variations. */
interface LookSource {
  readonly name: string;
  readonly editor?: { readonly variations?: readonly BlockVariation[] };
}

/**
 * The id a look's class carries: stable for as long as the block keeps the
 * look's name, which is what documents wearing it reference.
 */
export function lookClassId(blockType: string, name: string): string {
  return `look:${blockType}:${name}`;
}

/**
 * The CSS-facing name of a look: `button-outline` for a core block, and the
 * whole type for any other (`acme-hero-dark`), so two namespaces' blocks of
 * one name never share a class.
 */
function lookSlug(blockType: string, name: string): string {
  const type = blockType.startsWith("core/")
    ? blockType.slice("core/".length)
    : blockType.replace("/", "-");
  return `${type}-${name}`;
}

/**
 * The slug an own look is stored under: its look slug, lowercased, with every
 * run of characters a class name can't hold made one dash and the ends
 * trimmed, so "Primary Choice" gives `button-primary-choice`. Never emitted,
 * so it only has to pass the library's own checks.
 */
function ownLookSlug(blockType: string, name: string): string {
  return lookSlug(blockType, name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, MAX_NAMED_CLASS_NAME_LENGTH)
    .replace(/^-+|-+$/g, "");
}

/**
 * Every look the given block definitions declare that a block may wear, as
 * classes bound to their block types, in declaration order. A variation
 * without styles is an insert preset or the block's own look, not one of
 * these; a look whose name can't be written as a class name is left out.
 */
export function blockLooks(definitions: Iterable<LookSource>): NamedClass[] {
  return looksOf(definitions, false);
}

/**
 * Each block's own look (the variation marked `isDefault`, a button's
 * Primary), as a class bound to its block type with no styles and the
 * `isDefault` mark: where a site's edits to the block's base are stored. Kept
 * apart from {@link blockLooks}, because no block wears one.
 *
 * @experimental
 */
export function blockOwnLooks(definitions: Iterable<LookSource>): NamedClass[] {
  return looksOf(definitions, true);
}

/** The worn looks or the own looks the definitions declare, in declaration order. */
function looksOf(
  definitions: Iterable<LookSource>,
  own: boolean
): NamedClass[] {
  const looks: NamedClass[] = [];
  for (const definition of definitions) {
    for (const variation of definition.editor?.variations ?? []) {
      if ((variation.isDefault === true) !== own) continue;
      const look = lookOf(definition.name, variation, looks.length);
      if (look !== undefined) looks.push(look);
    }
  }
  return looks;
}

/**
 * One variation as a look's class, or `undefined` for a variation that is no
 * look (an insert preset), one whose class the engine could not use (a name
 * it can't write, or one too long), or a block's own look that also states
 * styles: its styles are the block's base, so a second set would be two
 * answers to what the block looks like.
 */
function lookOf(
  blockType: string,
  variation: BlockVariation,
  orderIndex: number
): NamedClass | undefined {
  const own = variation.isDefault === true;
  if (own === (variation.styles !== undefined)) return undefined;
  // An own look is never written to CSS, so any name the block gives it is
  // kept, under a slug made writable; a worn look's name must already be one.
  const slug = own
    ? ownLookSlug(blockType, variation.name)
    : lookSlug(blockType, variation.name);
  if (!NAMED_CLASS_SLUG_RE.test(slug)) return undefined;
  const look: NamedClass = {
    id: lookClassId(blockType, variation.name),
    slug,
    ...(variation.label === undefined ? {} : { label: variation.label }),
    orderIndex,
    blockType,
    // The own look starts with no edits: the block's base is its look.
    styles: variation.styles ?? {},
    ...(own ? { isDefault: true as const } : {}),
  };
  return isUsableNamedClass(look) ? look : undefined;
}
