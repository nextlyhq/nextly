/**
 * A card's size tier, from the width it is actually drawn at.
 *
 * The tier decides how a figure is written: only a small card compacts "1,248" to "1.2k",
 * because only there does the full value not fit. It is measured from the card's rendered width
 * rather than from its grid width setting, because the same setting draws narrow on a phone
 * and wide on a desktop, and what decides whether a number fits is the space it has.
 *
 * The frame measures once and provides the tier to everything inside it through context, so a
 * figure anywhere in a card's body -- a count, a bar's value, a table cell -- reads the same tier
 * without each archetype being handed it.
 *
 * @module components/features/widgets/frame/tier
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { createContext, useContext, type RefObject } from "react";

import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";

/** Below this rendered width a card is small: a full grouped figure may not fit. */
const SMALL_BELOW_PX = 340;
/** From this rendered width a card is large. */
const LARGE_FROM_PX = 700;

/** The tier for a rendered width, or `undefined` before the card has one. */
export function tierForWidth(width: number | null): SizeTier | undefined {
  if (width === null) return undefined;
  if (width < SMALL_BELOW_PX) return "small";
  return width >= LARGE_FROM_PX ? "large" : "medium";
}

/** The tier of the card being drawn; `undefined` outside a card or before it is measured. */
export const CardTierContext = createContext<SizeTier | undefined>(undefined);

/** The tier of the card this is drawn in. */
export function useCardTier(): SizeTier | undefined {
  return useContext(CardTierContext);
}

/**
 * Measures the card at `ref` and answers its tier, which the frame then provides.
 *
 * A tier the caller states wins over the measured one, so a card drawn somewhere without a
 * layout of its own -- a preview, a test -- can still be given one.
 */
export function useMeasuredTier(
  ref: RefObject<HTMLElement | null>,
  stated?: SizeTier
): SizeTier | undefined {
  const measured = tierForWidth(useMeasuredWidth(ref));
  return stated ?? measured;
}
