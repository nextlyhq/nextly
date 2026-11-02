"use client";

/**
 * A card's header slot: where a body draws the controls that act on the whole card, such as the
 * setup card's collapse and dismiss, in the frame's header just before the card's quick control
 * and its menu.
 *
 * Drawn in the header rather than in the body, they take none of the body's width or height, so
 * the body's own content is laid out across the card's whole width, and the controls stand where
 * every card's own controls stand. The header keeps its one fixed height: what a body draws here
 * is a row of small icon buttons, one header line high.
 *
 * The frame offers the slot only at rest: in customise mode the card's size and menu stand at the
 * header's right end and the body is out of reach, so a body's controls are not drawn there. Outside
 * a frame (a preview, a test drawing a body alone) there is no header, and the content is drawn
 * where it stands. The same shape as the footer slot (`footer-slot`).
 *
 * @module components/features/widgets/frame/header-slot
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
 * The frame's header slot: `undefined` outside a frame, `null` while the slot is still mounting or
 * not offered (customise mode), so nothing is drawn in the body and then moved.
 */
const CardHeaderSlot = createContext<HTMLElement | null | undefined>(undefined);

/** Provided by the frame, around its body, once its header slot is mounted. */
export const CardHeaderSlotProvider: Provider<HTMLElement | null | undefined> =
  CardHeaderSlot.Provider;

/** Draws `children` in the card's header, before its quick control and menu. */
export function CardHeaderContent({
  children,
}: {
  children: ReactNode;
}): JSX.Element | null {
  const slot = useContext(CardHeaderSlot);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  return createPortal(children, slot);
}
