/**
 * A card body drawn inside the frame, as the dashboard draws it: what a body
 * reports with `FrameState` is drawn by the frame, so a test of a body's state
 * reads the frame's own state components, as a reader sees them.
 *
 * The frame keeps the size tier a test provides around it, rather than
 * measuring its own (jsdom measures every element as zero wide), and the card
 * height a test provides, which its list rows are counted from.
 */
import { useContext, type ReactNode, type JSX } from "react";

import { CardHeightContext, useCardTier } from "../frame/tier";
import { WidgetCard } from "../WidgetCard";

function Framed({ body, title }: { body: ReactNode; title: string }) {
  const tier = useCardTier();
  const h = useContext(CardHeightContext);
  return (
    <WidgetCard
      title={title}
      {...(tier === undefined ? {} : { tier })}
      {...(h === undefined ? {} : { h })}
    >
      {body}
    </WidgetCard>
  );
}

export function inFrame(body: ReactNode, title = "Card"): JSX.Element {
  return <Framed body={body} title={title} />;
}
