"use client";

/**
 * A card's footer slot: the one place a card's link is drawn, at the foot of its frame.
 *
 * The frame always draws its footer, a link's line high, whether or not anything is in it, so a
 * card's body is one height ("cardBodyHeightPx") and a list's rows do not change when "View all"
 * appears. What a body has for the footer, such as a list's "View all (N)", it hands to the frame
 * here rather than drawing it under its own rows: drawn in the body it would take room the rows
 * were counted for, and a card would end at a different line from the card beside it.
 *
 * Outside a frame (a preview, a test drawing a body alone) there is no footer to draw into, and
 * the content is drawn where it stands.
 *
 * @module components/features/widgets/frame/footer-slot
 */

import {
  createContext,
  useContext,
  type JSX,
  type Provider,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

/**
 * The frame's footer element: `undefined` outside a frame, `null` while the frame's footer is
 * still mounting, so nothing is drawn in the body for that first render and then moved.
 */
const CardFooterSlot = createContext<HTMLElement | null | undefined>(undefined);

/** Provided by the frame, around its body, once its footer is mounted. */
export const CardFooterSlotProvider: Provider<HTMLElement | null | undefined> =
  CardFooterSlot.Provider;

/**
 * A card footer's link, the frame's own and a body's alike: foreground, with the brand on the
 * underline. A brand primary is any colour its owner picked, and small text in it can fall under
 * AA contrast.
 */
export const CARD_FOOTER_LINK_CLASS =
  "text-xs font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary";

/** Draws `children` in the card's footer, or where it stands outside a frame. */
export function CardFooterContent({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const slot = useContext(CardFooterSlot);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  return createPortal(children, slot);
}
