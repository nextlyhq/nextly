"use client";

/**
 * Where the reader is among a version's changes, shared by the editor and the
 * comparison page so both move through changes the same way.
 *
 * @module components/features/versions/useChangeNavigation
 */

import { useState } from "react";

import { changeAnchorId } from "./VersionChangesForm";

/**
 * Where the reader is among a version's changes, and the move to the
 * previous or next one. A move brings the change into view and focuses it,
 * so a keyboard or screen reader user lands on it as well as seeing it.
 */
export function useChangeNavigation(order: readonly string[]) {
  const [position, setPosition] = useState(0);
  const at = Math.min(position, Math.max(order.length - 1, 0));
  const move = (delta: -1 | 1) => {
    if (order.length === 0) return;
    const next = (at + delta + order.length) % order.length;
    setPosition(next);
    const target = document.getElementById(changeAnchorId(order[next]));
    target?.scrollIntoView({ block: "center", behavior: "smooth" });
    target?.focus({ preventScroll: true });
  };
  return { position: at, current: order[at] ?? null, move };
}
