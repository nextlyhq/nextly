/**
 * Whether the person's setting asks for reduced motion, kept current as it changes.
 *
 * A chart animates its marks in only when this is `false`. Read here rather than left to the
 * chart engine's own "auto", so the choice is the admin's and a test can set it. On the server,
 * and anywhere `matchMedia` is missing, the answer is `true`: no animation is the safe default.
 *
 * @module components/features/widgets/charts/reduced-motion
 */

import { useSyncExternalStore } from "react";

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function query(): MediaQueryList | undefined {
  return typeof window !== "undefined" &&
    typeof window.matchMedia === "function"
    ? window.matchMedia(REDUCED_MOTION)
    : undefined;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  list?.addEventListener("change", onChange);
  return () => list?.removeEventListener("change", onChange);
}

/** `true` while the person asks for reduced motion, or where it cannot be read. */
export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query()?.matches ?? true,
    () => true
  );
}
