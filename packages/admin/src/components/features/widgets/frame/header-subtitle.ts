/**
 * A line a card's body shows beneath its title: "8 collections · 5 Singles". Drawn by the frame's
 * header in the subtitle's place and style; reported by the body, which is the one that knows
 * what it summarises. A subtitle the card is given (the widget's own name beneath a title that
 * names its subject) wins over the body's, so the line that tells two cards apart is never lost.
 *
 * Reported before the paint (a layout effect), so the header is drawn with it from the first
 * frame its body is drawn in; withdrawn when the body unmounts. The same shape as the title's
 * count (`title-count`).
 *
 * @module components/features/widgets/frame/header-subtitle
 */

import { createContext, useContext, useLayoutEffect } from "react";

/** Where a card's body reports its subtitle; absent outside a frame. */
export const CardSubtitleContext = createContext<
  ((subtitle: string | undefined) => void) | undefined
>(undefined);

/** Shows `subtitle` beneath the card's title while this body is drawn. */
export function useCardSubtitle(subtitle: string | undefined): void {
  const report = useContext(CardSubtitleContext);
  useLayoutEffect(() => {
    report?.(subtitle);
  }, [report, subtitle]);
  useLayoutEffect(() => () => report?.(undefined), [report]);
}
