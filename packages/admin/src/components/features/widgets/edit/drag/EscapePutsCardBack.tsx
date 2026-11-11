"use client";

/**
 * Escape while a card's edge is held: the card goes back to the width it was picked up at, and
 * the other cards slide back with it (`useCardResize`).
 *
 * Bound through the admin's one shortcut owner, and drawn only while an edge is held, so Escape
 * is the resize's for no longer than that.
 *
 * @module components/features/widgets/edit/drag/EscapePutsCardBack
 */

import type { JSX } from "react";

import { useKeyboardShortcuts } from "@admin/hooks/useKeyboardShortcuts";

export function EscapePutsCardBack({
  cancel,
}: {
  cancel: () => void;
}): JSX.Element | null {
  useKeyboardShortcuts(
    [
      {
        key: "Escape",
        action: cancel,
        description: "Put the card back at the width it had",
        // Wherever focus is: a press on the edge leaves focus where it was, a field included.
        whenTyping: true,
      },
    ],
    { name: "dashboard-card-resize" }
  );
  return null;
}
