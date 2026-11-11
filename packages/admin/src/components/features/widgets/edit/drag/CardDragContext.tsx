"use client";

/**
 * The drag library's context around the dashboard's cards, and the picture a pointer drag holds.
 *
 * Its own component so the grid states only that its cards can be dragged: which sensors run,
 * what is announced and what follows the pointer are the drag's business (`useCardDrag`).
 *
 * @module components/features/widgets/edit/drag/CardDragContext
 */

import {
  DndContext,
  DragOverlay,
  defaultDropAnimationSideEffects,
  type DropAnimation,
} from "@dnd-kit/core";
import { useCallback, type JSX, type ReactNode } from "react";

import { usePrefersReducedMotion } from "../../charts/reduced-motion";

import { SLIDE_MS } from "./useCardFlip";
import { SILENT_DRAG, type CardDrag } from "./useCardDrag";

/**
 * On release the picture settles into the card's new place, as the other cards slide into
 * theirs; the card itself is drawn once the picture has arrived.
 */
const SETTLE: DropAnimation = {
  duration: SLIDE_MS,
  easing: "cubic-bezier(0.2, 0.8, 0.2, 1)",
  sideEffects: defaultDropAnimationSideEffects({
    styles: { active: { opacity: "0" } },
  }),
};

/**
 * The card as it was picked up, under the pointer: a copy of what was drawn, lifted off the page
 * with a shadow. Drawn only, never reached or read: the card itself is still on the page, as
 * the outline where it will land.
 */
function CardGhost({ picture }: { picture: HTMLElement }) {
  const hold = useCallback(
    (element: HTMLDivElement | null) => {
      element?.replaceChildren(picture);
    },
    [picture]
  );
  return (
    <div
      ref={hold}
      aria-hidden
      inert
      data-testid="widget-drag-ghost"
      className="h-full w-full cursor-grabbing rounded-lg opacity-95 shadow-lg"
    />
  );
}

export function CardDragContext({
  drag,
  children,
}: {
  drag: CardDrag;
  children: ReactNode;
}): JSX.Element {
  const reduced = usePrefersReducedMotion();
  const picture = drag.drag?.ghost ?? null;
  return (
    <DndContext
      // The same sensors at every width. dnd-kit reads the list as an effect's dependencies, so
      // a list that empties at one column changes size between renders, which React warns of
      // and does not promise to handle. A drag cannot start there anyway: the grid hands a card
      // no drag while dragging is off, so its `useDraggable` is disabled and no handle is drawn.
      sensors={drag.sensors}
      onDragStart={drag.onDragStart}
      onDragMove={drag.onDragMove}
      onDragEnd={drag.onDragEnd}
      onDragCancel={drag.onDragCancel}
      accessibility={{ announcements: SILENT_DRAG }}
    >
      {children}
      <DragOverlay dropAnimation={reduced ? null : SETTLE}>
        {picture === null ? null : <CardGhost picture={picture} />}
      </DragOverlay>
    </DndContext>
  );
}
