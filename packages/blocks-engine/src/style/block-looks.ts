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
 * Every look the given block definitions declare, as classes bound to their
 * block types, in declaration order. The block's own look (`isDefault`) comes
 * with no styles of its own and the `isDefault` mark, so a site's edits to the
 * block's base have a class to be stored as. Any other variation without
 * styles is an insert preset, not a look; a look whose name can't be written
 * as a class name is left out.
 */
export function blockLooks(definitions: Iterable<LookSource>): NamedClass[] {
  const looks: NamedClass[] = [];
  for (const definition of definitions) {
    for (const variation of definition.editor?.variations ?? []) {
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
  const slug = lookSlug(blockType, variation.name);
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
