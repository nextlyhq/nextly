"use client";
/**
 * A count that moves once a value has stayed the same for a while: what the
 * editor's asks of the server wait on, so a page is asked about once per
 * pause in editing, never once per keystroke.
 *
 * @module admin/editor/use-paused
 */
import { useEffect, useRef, useState } from "react";

/** A count that moves once `value` has stayed the same for `ms`. */
export function usePaused(value: unknown, ms: number): number {
  const [paused, setPaused] = useState(0);
  // The first value is the page as opened, which the asks make on mounting.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    const timer = setTimeout(() => setPaused(count => count + 1), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return paused;
}
