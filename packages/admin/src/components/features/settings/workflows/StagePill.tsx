"use client";

/**
 * A stage's label drawn on its colour: a palette swatch's tokens, or the
 * neutral swatch for a stage with no colour. A stored value outside the
 * palette keeps the neutral swatch and shows that value as its dot only, so
 * the label's contrast never depends on a colour the palette did not check.
 */

import type React from "react";

import { cn } from "@admin/lib/utils";

import { NEUTRAL_SWATCH, stageColourOf } from "./stage-colours";

export interface StagePillProps {
  label: string;
  /** The stored colour, or none. */
  colour: string | undefined;
  className?: string;
}

export function StagePill({
  label,
  colour,
  className,
}: StagePillProps): React.JSX.Element {
  const drawn = stageColourOf(colour);
  const swatch = drawn.kind === "swatch" ? drawn.swatch : NEUTRAL_SWATCH;
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium",
        swatch.surface,
        swatch.label,
        className
      )}
    >
      {drawn.kind === "custom" ? (
        <span
          aria-hidden="true"
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: drawn.value }}
        />
      ) : (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", swatch.dot)}
        />
      )}
      {label}
    </span>
  );
}
