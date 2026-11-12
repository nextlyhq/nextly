/**
 * The number a plugin's panel item shows beside its label: a quiet count, or
 * a badge that asks for attention.
 *
 * Drawn for the eye and spoken apart. The visible number is hidden from
 * assistive technology, and the link is named with it (`itemNumberName`), so
 * the link reads "Patterns, 12" rather than "Patterns12", and a badge reads as
 * the Needs your attention card names a count, "Bindings to fix: 2".
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
 * The number the item draws, or nothing: before it is read, when it cannot
 * be, and for a badge at 0, which has nothing to ask for. A quiet count draws
 * 0. One answer for what is drawn and what is spoken.
 */
function drawnNumber(shown: ShownItemNumber): PanelItemNumber | undefined {
  const { kind, number } = shown;
  if (number === undefined) return undefined;
  if (kind === "badge" && number.value === 0) return undefined;
  return number;
}

/**
 * The item's accessible name while it draws a number: its label, then the
 * number as spoken, "Patterns, 12" for a count and "Bindings to fix: 2" for a
 * badge, as the Needs your attention card names a count. `undefined` while it
 * draws none, so the name is the label the link holds.
 *
 * Given as the link's own `aria-label` rather than assembled from its parts:
 * a browser joins a visually hidden part to the label with a space, so the
 * name read "Patterns , 12". It starts with the visible label, so the name
 * still holds what is seen.
 */
export function itemNumberName(
  label: string,
  shown: ShownItemNumber | undefined
): string | undefined {
  const number = shown === undefined ? undefined : drawnNumber(shown);
  if (shown === undefined || number === undefined) return undefined;
  const joiner = shown.kind === "badge" ? ": " : ", ";
  return `${label}${joiner}${itemNumberSpoken(number)}`;
}

/** The number as drawn, hidden from assistive technology: the name says it. */
/** Where a quiet count sits: at the item's end, at least two digits wide. */
const COUNT_SLOT = "ml-auto min-w-[2ch] shrink-0 text-right";

export function PluginItemNumber({
  shown,
}: {
  shown: ShownItemNumber;
}): React.JSX.Element | null {
  const number = drawnNumber(shown);
  // A count keeps its slot while it is read, so the label beside it is the
  // same width before and after and never re-truncates when the number lands.
  // A badge appears only when something needs attention, and takes its room then.
  if (number === undefined) {
    return shown.kind === "count" ? (
      <span aria-hidden="true" className={COUNT_SLOT} />
    ) : null;
  }
  return (
    <span
      aria-hidden="true"
      data-testid={`plugin-item-${shown.kind}`}
      className={
        shown.kind === "badge"
          ? "ml-auto inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full border border-border px-1.5 text-[11px] font-semibold tabular-nums"
          : `${COUNT_SLOT} text-xs tabular-nums text-muted-foreground`
      }
    >
      {itemNumberText(number)}
    </span>
  );
}
