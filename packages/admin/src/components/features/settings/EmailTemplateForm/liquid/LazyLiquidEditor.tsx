"use client";

/**
 * The email editor, loaded when a workbench first shows one.
 *
 * CodeMirror reaches for browser globals on import, and the editor brings the
 * Liquid grammar and LiquidJS, which the rest of the admin never needs: loaded
 * here on demand, none of it is part of the admin's startup. While it loads,
 * a box of the field's size holds its place, so nothing moves when it arrives.
 */
import { Suspense, lazy } from "react";

import { cn } from "@admin/lib/utils";

import type { LiquidEditorProps } from "./LiquidEditor";

const LiquidEditor = lazy(() =>
  import("./LiquidEditor").then(module => ({ default: module.LiquidEditor }))
);

export function LazyLiquidEditor(props: LiquidEditorProps) {
  const fallback = (
    <div
      aria-hidden
      className={cn(
        "w-full animate-pulse rounded-md border border-input bg-muted/30",
        props.singleLine ? "h-9" : "min-h-95"
      )}
    />
  );
  return (
    <Suspense fallback={fallback}>
      <LiquidEditor {...props} />
    </Suspense>
  );
}
