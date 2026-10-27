/**
 * A card body drawn inside the frame, as the dashboard draws it: what a body
 * reports with `FrameState` is drawn by the frame, so a test of a body's state
 * reads the frame's own state components, as a reader sees them.
 *
 * The frame keeps the size tier a test provides around it, rather than
 * measuring its own (jsdom measures every element as zero wide).
 */
import type { ReactNode, JSX } from "react";

import { useCardTier } from "../frame/tier";
import { WidgetCard } from "../WidgetCard";

function Framed({ body, title }: { body: ReactNode; title: string }) {
  const tier = useCardTier();
  return (
    <WidgetCard title={title} {...(tier === undefined ? {} : { tier })}>
      {body}
    </WidgetCard>
  );
}

export function inFrame(body: ReactNode, title = "Card"): JSX.Element {
  return <Framed body={body} title={title} />;
}
