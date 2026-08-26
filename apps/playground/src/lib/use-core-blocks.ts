"use client";

import { hasBlock, registerBlocks } from "@nextlyhq/blocks-engine";
import { coreBlocks } from "@nextlyhq/blocks-react/blocks";
import { useMemo } from "react";

/**
 * Register the core blocks before anything reads the registry.
 *
 * Shared by the harness routes rather than repeated in each, because the guard
 * is the interesting part and a second copy is a second place to lose it: the
 * registry is process-wide, so an unconditional registration throws on a dev
 * server hot reload where the module is re-evaluated and the registry survives.
 * Only the blocks actually missing are registered, through the same guarded call
 * the production host uses.
 *
 * `useMemo` rather than an effect, so the registry is populated during the
 * render that first reads it. An effect runs after, and the first paint would
 * resolve every block to a placeholder.
 *
 * The SOURCE stays a per-caller argument: it is what the registry reports when
 * two registrations disagree, and a shared constant would name one harness in
 * the other's error.
 */
export function useCoreBlocks(source: string): void {
  useMemo(() => {
    const missing = coreBlocks.filter(block => !hasBlock(block.name));
    if (missing.length > 0) registerBlocks(missing, { source });
  }, [source]);
}
