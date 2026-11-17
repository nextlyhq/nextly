/**
 * A Gallery's "Columns" and "On mobile" tiles: what each choice writes, and
 * what the tiles read back.
 *
 * A Content control that writes the gallery's own style values, as a
 * Columns row's Layout tiles do (`columns-layout.ts`): Columns is its
 * `grid-template-columns` at the base values, On mobile the same property at
 * the site's mobile tier, the widest at a phone's width or narrower
 * (`stackTiers`). Each is a count of equal tracks that may shrink past their
 * content, so a wide picture never pushes the grid wider than the box.
 *
 * With nothing stored the block's own grid draws three across and one on a
 * phone, so the tiles read 3 and 1. Choosing Columns while the mobile tier
 * holds nothing also writes On mobile's 1 in the same edit: a stored count
 * reaches every narrower tier, and a phone must never inherit 3 or 4 across.
 *
 * @module gallery-columns
 */
import {
  BASE_BREAKPOINT,
  type BlockNode,
  type StyleValue,
} from "@nextlyhq/blocks-engine";

import { chainedStyleOp, type StackTiers } from "./columns-layout";
import type { BuilderOp } from "./op-vocabulary";
import { readStyleValue, type StyleAddress } from "./style-values";

/** The counts the Columns tiles offer. */
export const GALLERY_COLUMNS: readonly number[] = [2, 3, 4];

/** The counts the On mobile tiles offer. */
export const GALLERY_MOBILE: readonly number[] = [1, 2];

/** What the block's default grid draws where nothing is stored. */
const DEFAULT_COLUMNS = 3;
const DEFAULT_MOBILE = 1;

/** The property every choice here writes. */
const PROPERTY = "gridTemplateColumns";

/** The template a count writes: equal tracks that may shrink to nothing. */
function templateOf(count: number): string {
  return `repeat(${String(count)}, minmax(0, 1fr))`;
}

/** The count a stored template is, where it is one a tile writes. */
function countOf(value: StyleValue | undefined): number | undefined {
  if (typeof value !== "string") return undefined;
  const match =
    /^repeat\(\s*(\d+)\s*,\s*minmax\(\s*0\s*,\s*1fr\s*\)\s*\)$/.exec(
      value.trim()
    );
  return match?.[1] === undefined ? undefined : Number(match[1]);
}

/** Where a choice writes: the gallery's own base state, at one tier. */
function addressAt(breakpoint: string): StyleAddress {
  return { state: "base", breakpoint, property: PROPERTY, path: [] };
}

/** The template the gallery stores at a tier. */
function storedAt(
  gallery: BlockNode,
  breakpoint: string
): StyleValue | undefined {
  return readStyleValue(gallery.styles, addressAt(breakpoint));
}

/** What the two rows of tiles read: a count each, or none for no tile. */
export interface GalleryColumns {
  readonly columns: number | undefined;
  /** `undefined` also where the site has no mobile tier, so no row is drawn. */
  readonly mobile: number | undefined;
}

/**
 * The template a wider tier hands down to a phone while the phone's own tier
 * says nothing: the nearest of the tiers between the base values and the
 * phone's that stores one, since a narrower tier's rule comes later in the
 * page's styles and wins where both apply.
 */
function reachingPhone(
  gallery: BlockNode,
  tiers: StackTiers
): StyleValue | undefined {
  const managed = tiers.managed ?? [];
  const at = managed.findIndex(tier => tier.id === tiers.mobile);
  // Widest first, so the ones before the phone's are wider; nearest first.
  const wider = at === -1 ? [] : managed.slice(0, at).reverse();
  for (const tier of wider) {
    const stored = storedAt(gallery, tier.id);
    if (stored !== undefined) return stored;
  }
  return undefined;
}

/**
 * The counts the gallery lays its pictures out in: its own, else the
 * default grid's. On a phone, the mobile tier's own, else the count a wider
 * tier reaches it with (a tablet's, then the base values), else the
 * default's one.
 */
export function galleryColumnsOf(
  gallery: BlockNode,
  tiers: StackTiers
): GalleryColumns {
  const base = storedAt(gallery, BASE_BREAKPOINT);
  const columns = base === undefined ? DEFAULT_COLUMNS : countOf(base);
  if (tiers.mobile === undefined) return { columns, mobile: undefined };
  const phone =
    storedAt(gallery, tiers.mobile) ?? reachingPhone(gallery, tiers) ?? base;
  const mobile = phone === undefined ? DEFAULT_MOBILE : countOf(phone);
  return { columns, mobile };
}

/**
 * Choosing Columns, as ONE op: the count at the base values, and On mobile's
 * default at the mobile tier while nothing narrower than the base values
 * reaches a phone. `null` where it changes nothing.
 */
export function planGalleryColumns(
  gallery: BlockNode,
  count: number,
  tiers: StackTiers
): BuilderOp | null {
  const steps: { address: StyleAddress; value: StyleValue }[] = [
    { address: addressAt(BASE_BREAKPOINT), value: templateOf(count) },
  ];
  // Only where the base value is what reaches a phone: a tablet's count, or
  // the phone's own, already decides it there.
  if (
    tiers.mobile !== undefined &&
    storedAt(gallery, tiers.mobile) === undefined &&
    reachingPhone(gallery, tiers) === undefined
  ) {
    steps.push({
      address: addressAt(tiers.mobile),
      value: templateOf(DEFAULT_MOBILE),
    });
  }
  return chainedStyleOp(gallery, steps);
}

/**
 * Choosing On mobile, as ONE op at the mobile tier; `null` where the site
 * has none, or it changes nothing.
 */
export function planGalleryMobile(
  gallery: BlockNode,
  count: number,
  tiers: StackTiers
): BuilderOp | null {
  if (tiers.mobile === undefined) return null;
  return chainedStyleOp(gallery, [
    { address: addressAt(tiers.mobile), value: templateOf(count) },
  ]);
}

/** Whether the gallery stores a count of its own, for its section's dot. */
export function galleryColumnsHoldValue(
  gallery: BlockNode,
  tiers: StackTiers
): boolean {
  return (
    storedAt(gallery, BASE_BREAKPOINT) !== undefined ||
    (tiers.mobile !== undefined &&
      storedAt(gallery, tiers.mobile) !== undefined)
  );
}
