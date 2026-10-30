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
 * A footer holds ONE link. What a body hands it takes the place of the widget's own `link` while
 * it is there (`CardFooterClaim`), so a list's "View all" never sits beside a second call to
 * action; and of what a body hands it, ONE is drawn: an explicit `Widget.FooterLink` over a list's
 * "View all", and the last drawn of equals (`FooterClaimRank`).
 *
 * @module components/features/widgets/frame/footer-slot
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
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
 * How strongly a body's footer content claims the footer: `"explicit"`, a widget's own
 * `Widget.FooterLink`, over `"body"`, a part's link such as a list's "View all (N)".
 */
export type FooterClaimRank = "explicit" | "body";

/**
 * The frame's footer claims, as a body sees them: `claim` registers one while it is drawn and
 * answers its id and the call that gives the footer back; `drawn` is the one claim whose content
 * the footer draws.
 */
export interface CardFooterClaims {
  claim: (rank: FooterClaimRank) => { id: number; release: () => void };
  drawn: number | undefined;
}

/**
 * How a body tells the frame its footer holds the body's own link, so the frame draws none of
 * its own, and learns whether its link is the one the footer draws.
 */
const CardFooterClaim = createContext<CardFooterClaims | undefined>(undefined);

/** Provided by the frame, around its body, beside the footer's element. */
export const CardFooterClaimProvider: Provider<CardFooterClaims | undefined> =
  CardFooterClaim.Provider;

/** Which of `claims` the footer draws: the highest rank, and the last drawn of equals. */
export function drawnClaim(
  claims: readonly { id: number; rank: FooterClaimRank }[]
): number | undefined {
  const explicit = claims.filter(claim => claim.rank === "explicit");
  return (explicit.length > 0 ? explicit : claims).at(-1)?.id;
}

/**
 * A card footer's link, the frame's own and a body's alike: foreground, with the brand on the
 * underline. A brand primary is any colour its owner picked, and small text in it can fall under
 * AA contrast.
 */
export const CARD_FOOTER_LINK_CLASS =
  "text-xs font-medium text-foreground underline decoration-primary/40 underline-offset-4 hover:decoration-primary focus-visible:decoration-primary";

/**
 * Draws `children` in the card's footer, or where it stands outside a frame, in place of the
 * widget's own link while it is drawn.
 *
 * 🔴 Replaces, never appends: the footer draws one claim's content (`drawnClaim`), so a
 * `Widget.FooterLink` beside a list's "View all" draws one link, the FooterLink's.
 */
export function CardFooterContent({
  children,
  rank = "body",
}: {
  children: ReactNode;
  /** How strongly it claims the footer; see `FooterClaimRank`. */
  rank?: FooterClaimRank;
}): JSX.Element | null {
  const slot = useContext(CardFooterSlot);
  const claims = useContext(CardFooterClaim);
  const [id, setId] = useState<number | undefined>(undefined);
  const claim = claims?.claim;
  useEffect(() => {
    if (claim === undefined) return undefined;
    const held = claim(rank);
    setId(held.id);
    return held.release;
  }, [claim, rank]);
  if (slot === undefined) return <>{children}</>;
  if (slot === null) return null;
  if (claims !== undefined && (id === undefined || claims.drawn !== id)) {
    return null;
  }
  return createPortal(children, slot);
}
