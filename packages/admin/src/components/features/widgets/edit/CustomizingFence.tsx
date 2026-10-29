"use client";

/**
 * A card's own content while customise mode is open: still drawn, out of reach.
 *
 * Customising is about the arrangement, so a click meant for a card's handle
 * or menu must never follow one of the card's own links instead, and Tab must
 * go from one card's controls to the next rather than through every link and
 * button inside each card. `inert` does both, for pointer, keyboard and
 * assistive technology alike, and it is applied to the CONTENT only: the drag
 * handle, the size label and the card menu are drawn outside it.
 *
 * @module components/features/widgets/edit/CustomizingFence
 */

import type { JSX, ReactNode } from "react";

export function CustomizingFence({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div
      // React 19 renders a boolean `inert` as the attribute itself.
      inert
      data-testid="card-content-fence"
      // The fence stands in the cell where the card used to, so the card still fills the row's
      // height. The card dims its own body and footer in customise mode (`WidgetCard`), so the
      // fence only puts its content out of reach.
      className="h-full"
    >
      {children}
    </div>
  );
}

/**
 * Room in a framed card's header for the controls drawn over it.
 *
 * The card's size label and menu sit over the header's right end, outside the
 * fence, so the header reserves their space and its title truncates before
 * them rather than running underneath. Sized for the widest label, "12×12".
 */
export function CardControlsSpace(): JSX.Element {
  return <span aria-hidden className="block h-7 w-16" />;
}

/**
 * The framed card's size label and menu, placed over its header's right end.
 *
 * `inset-px` stands in for the card's one-pixel border, so `top-5 right-5`
 * lands exactly where the header's own padding puts its last item. The outer
 * layer lets the pointer through to the card everywhere but the controls.
 */
export function CardControlsOverlay({
  children,
}: {
  children: ReactNode;
}): JSX.Element {
  return (
    <div className="pointer-events-none absolute inset-px z-10">
      <div className="pointer-events-auto absolute right-5 top-5">
        {children}
      </div>
    </div>
  );
}
