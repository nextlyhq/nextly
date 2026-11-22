"use client";

/**
 * A drag in the outline, as one more way to move a field: the row it is over
 * and how far sideways the pointer went (in levels of indent) name a place,
 * which the move rule judges like any other. While dragging, the reason a
 * place is refused is shown; on drop, the move is carried out or refused and
 * announced, as a key or the menu would be.
 */
import { useDndMonitor, type DragMoveEvent } from "@dnd-kit/core";
import { useState } from "react";

import { crumbTargetOf } from "./FocusCrumbs";
import type { OutlineActions } from "./outline-types";
import { INDENT } from "./OutlineRow";

/** How many levels of indent a sideways offset is, toward zero. */
function levelsOf(event: Pick<DragMoveEvent, "delta">): number {
  return Math.trunc(event.delta.x / INDENT);
}

/** Why the place a drag is over is refused, while it is; null otherwise. */
export function useOutlineDrag(actions: OutlineActions): string | null {
  const [refused, setRefused] = useState<string | null>(null);
  useDndMonitor({
    onDragMove: event => {
      const { active, over } = event;
      const crumb = over ? crumbTargetOf(String(over.id)) : null;
      // Over a Focus crumb, the place is the end of that crumb's level.
      const verdict = crumb
        ? actions.judgeMoveTo(String(active.id), crumb)
        : over
          ? actions.judgeDrop(
              String(active.id),
              String(over.id),
              levelsOf(event)
            )
          : null;
      setRefused(verdict && !verdict.allowed ? verdict.message : null);
    },
    onDragEnd: event => {
      setRefused(null);
      // Dropped over nothing: the drag context's own announcement says so.
      if (event.over) {
        const crumb = crumbTargetOf(String(event.over.id));
        if (crumb) actions.moveTo(String(event.active.id), crumb);
        else {
          actions.drop(
            String(event.active.id),
            String(event.over.id),
            levelsOf(event)
          );
        }
      }
    },
    onDragCancel: () => setRefused(null),
  });
  return refused;
}
