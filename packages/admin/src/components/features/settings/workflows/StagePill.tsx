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
  colour: string | null | undefined;
  className?: string;
}

/**
 * A stage's colour as a dot: the swatch's solid, a stored value outside the
 * palette as itself, or a hollow ring for a stage with none. The one drawing of
 * a stage's colour, used in its pill and beside its name in a line of text.
 */
export function StageDot({
  colour,
}: {
  colour: string | null | undefined;
}): React.JSX.Element {
  const drawn = stageColourOf(colour ?? undefined);
  if (drawn.kind === "custom") {
    return (
      <span
        aria-hidden="true"
        className="inline-block size-2 shrink-0 rounded-full"
        style={{ backgroundColor: drawn.value }}
      />
    );
  }
  const swatch = drawn.kind === "swatch" ? drawn.swatch : NEUTRAL_SWATCH;
  return (
    <span
      aria-hidden="true"
      className={cn("inline-block size-2 shrink-0 rounded-full", swatch.dot)}
    />
  );
}

export function StagePill({
  label,
  colour,
  className,
}: StagePillProps): React.JSX.Element {
  const drawn = stageColourOf(colour ?? undefined);
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
      <StageDot colour={colour} />
      <span>{label}</span>
    </span>
  );
}
