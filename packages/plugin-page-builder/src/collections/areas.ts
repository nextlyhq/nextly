/**
 * The areas a Layout can fill, declared once.
 *
 * Two collections read this and neither owns it. A Layout offers these as the
 * positions a row can take; a component offers them as the hint saying which
 * position it suits. Those are the two ends of one question — which is what
 * makes a second copy dangerous rather than merely untidy. Two lists agree the
 * day they are written and diverge the first time either is edited alone, and
 * the divergence is silent in both directions: an area a Layout can name that
 * no component can be marked for, or a component marked for an area no Layout
 * offers, and in each case the picker simply comes back empty.
 *
 * It lives in its own module rather than in either collection because the two
 * already point at each other — a Layout row references the components
 * collection by slug — so putting the list in one of them would close a cycle
 * to reach a constant.
 *
 * @module collections/areas
 */

/**
 * Every position a Layout wraps a page with.
 *
 * `as const` so the values are literal types: the option lists built from this
 * are checked against the same union a reader narrows against, and a string
 * that is not one of these cannot be stored by anything that consults it.
 *
 * Adding an announcement bar or a sidebar is an entry here. It costs no
 * migration, because the areas a Layout holds are rows rather than columns.
 */
export const LAYOUT_AREAS = ["header", "footer"] as const;

/** One of the positions a Layout wraps a page with. */
export type LayoutArea = (typeof LAYOUT_AREAS)[number];

/**
 * The area list as select options.
 *
 * Derived rather than written out, so a value can be added in exactly one
 * place. Both fields that offer these call this: a hand-written option list
 * beside the constant is the same divergence this module exists to prevent,
 * one level down.
 */
export function layoutAreaOptions(): { label: string; value: LayoutArea }[] {
  return LAYOUT_AREAS.map(value => ({ label: value, value }));
}
