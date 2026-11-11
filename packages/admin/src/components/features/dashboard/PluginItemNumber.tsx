/**
 * The number a plugin's panel item shows beside its label: a quiet count, or
 * a badge that asks for attention.
 *
 * Drawn for the eye and spoken apart. The visible number is hidden from
 * assistive technology, and a visually hidden phrase carries it into the
 * link's name instead, so the link reads "Patterns, 12" rather than
 * "Patterns12", and a badge reads as the Needs your attention card names a
 * count, "Bindings to fix: 2".
 *
 * @module components/features/dashboard/PluginItemNumber
 */
import type React from "react";

import {
  itemNumberSpoken,
  itemNumberText,
  type PanelItemNumber,
} from "@admin/lib/plugins/panel-counts";

/** What an item shows: which kind of number it declares, and the number once read. */
export interface ShownItemNumber {
  readonly kind: "count" | "badge";
  /** Absent until the panel's batch answers, and when it could not be read. */
  readonly number?: PanelItemNumber;
}

/**
 * The item's number, or nothing: before it is read, when it cannot be, and
 * for a badge at 0, which has nothing to ask for. A quiet count shows 0.
 */
export function PluginItemNumber({
  shown,
}: {
  shown: ShownItemNumber;
}): React.JSX.Element | null {
  const { kind, number } = shown;
  if (number === undefined) return null;
  if (kind === "badge" && number.value === 0) return null;
  const spoken =
    kind === "badge"
      ? `: ${itemNumberSpoken(number)}`
      : `, ${itemNumberSpoken(number)}`;
  return (
    <>
      <span
        aria-hidden="true"
        data-testid={`plugin-item-${kind}`}
        className={
          kind === "badge"
            ? "ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-border px-1.5 text-[11px] font-semibold tabular-nums"
            : "ml-auto shrink-0 text-xs tabular-nums text-muted-foreground"
        }
      >
        {itemNumberText(number)}
      </span>
      <span className="sr-only">{spoken}</span>
    </>
  );
}
