"use client";

/**
 * A card's own content while customise mode is open: still drawn, out of reach.
 *
 * Customising is about the arrangement, so a click meant for a card's handle
 * or menu must never follow one of the card's own links instead, and Tab must
 * go from one card's controls to the next rather than through every link and
 * button inside each card. `inert` does both, for pointer, keyboard and
 * assistive technology alike, and it is applied to the CONTENT only: the drag
 * handle, the width and the card menu are drawn outside it.
 *
 * @module components/features/widgets/edit/CustomizingFence
 */

import type { ReactNode } from "react";

import { cn } from "@admin/lib/utils";

/**
 * Sets `inert` on the element it is attached to.
 *
 * Through the DOM rather than as a prop, because the admin runs on React 18
 * and 19 and they disagree about the attribute: React 18 drops a boolean
 * `inert`, and React 19 reads the string form `""` as false. Attached only
 * while customising, since the fence itself exists only then.
 */
function fenceOff(element: HTMLElement | null): void {
  element?.setAttribute("inert", "");
}

export function CustomizingFence({
  framed,
  children,
}: {
  /**
   * Whether the widget is drawn in the card frame. A framed card keeps its
   * title and border at full strength and dims its body and footer, through
   * the slots the card primitives name; an unframed section has no frame to
   * keep, so all of it dims.
   */
  framed: boolean;
  children: ReactNode;
}) {
  return (
    <div
      ref={fenceOff}
      data-testid="card-content-fence"
      className={cn(
        // The fence stands in the cell where the card used to, so a framed
        // card still fills the row's height.
        framed
          ? "h-full [&_[data-slot=card-content]]:opacity-60 [&_[data-slot=card-footer]]:opacity-60"
          : "opacity-60"
      )}
    >
      {children}
    </div>
  );
}

/**
 * Room in a framed card's header for the controls drawn over it.
 *
 * The card's width and menu sit over the header's right end, outside the
 * fence, so the header reserves their space and its title truncates before
 * them rather than running underneath. Sized for the widest label, "Full".
 */
export function CardControlsSpace() {
  return <span aria-hidden className="block h-7 w-16" />;
}

/**
 * The framed card's width and menu, placed over its header's right end.
 *
 * `inset-px` stands in for the card's one-pixel border, so `top-5 right-5`
 * lands exactly where the header's own padding puts its last item. The outer
 * layer lets the pointer through to the card everywhere but the controls.
 */
export function CardControlsOverlay({ children }: { children: ReactNode }) {
  return (
    <div className="pointer-events-none absolute inset-px z-10">
      <div className="pointer-events-auto absolute right-5 top-5">
        {children}
      </div>
    </div>
  );
}
