/**
 * A card's size tier, from the width it is actually drawn at.
 *
 * The tier decides how a figure is written: only a small card compacts "1,248" to "1.2k",
 * because only there does the full value not fit. It is measured from the card's rendered width
 * rather than from its grid width setting, because the same setting draws narrow on a phone
 * and wide on a desktop, and what decides whether a number fits is the space it has.
 *
 * The frame measures once and provides the tier to everything inside it through context, so a
 * figure anywhere in a card's body -- a count, a bar's value, a table cell -- reads the same tier
 * without each archetype being handed it.
 *
 * @module components/features/widgets/frame/tier
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { effectiveWidgetLimit, MAX_WIDGET_ROWS } from "nextly/config";
import { createContext, useContext, type RefObject, type Context } from "react";

import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";
import type { WidgetWidth } from "@admin/types/dashboard/widgets";

import { bandForWidth, drawnSpan, GRID_GAP_PX } from "../sizes";

/** Below this rendered width a card is small: a full grouped figure may not fit. */
const SMALL_BELOW_PX = 340;
/** From this rendered width a card is large. */
const LARGE_FROM_PX = 700;

/** The tier for a rendered width, or `undefined` before the card has one. */
export function tierForWidth(width: number | null): SizeTier | undefined {
  if (width === null) return undefined;
  if (width < SMALL_BELOW_PX) return "small";
  return width >= LARGE_FROM_PX ? "large" : "medium";
}

/**
 * The outer width, in pixels, of a card drawn at `width` on a dashboard `dashboardWidth` wide.
 *
 * Twelve tracks with a gap between each: a card spanning n of them takes n twelfths of the
 * dashboard and its share of the gaps, less the gap that follows it. This is the width the card
 * measures once drawn, so a tier read from it is the tier the card then measures.
 */
export function cardOuterWidth(
  width: WidgetWidth,
  dashboardWidth: number
): number {
  const tracks = drawnSpan(width, bandForWidth(dashboardWidth));
  return ((dashboardWidth + GRID_GAP_PX) * tracks) / 12 - GRID_GAP_PX;
}

/**
 * A card's tier before it is drawn: the tier its predicted outer width reads as.
 *
 * What a card's first query is sized by, since the query is asked before the card can measure
 * itself. Read through {@link tierForWidth}, the rule the measured tier uses, so the two cannot
 * disagree about a width; `undefined` while the dashboard itself has no width yet.
 */
export function predictedTier(
  width: WidgetWidth,
  dashboardWidth: number | null | undefined
): SizeTier | undefined {
  if (dashboardWidth === null || dashboardWidth === undefined) return undefined;
  return tierForWidth(cardOuterWidth(width, dashboardWidth));
}

/** The most rows a small card draws: below 340 px a fourth row is a scroll. */
export const SMALL_TIER_ROWS = 3;

/**
 * The rows a card of `tier` draws when its setting asks for `items`.
 *
 * One answer for every reader of it: the list and table displays draw this
 * many, the query asks for one more (to learn whether more exist), and the
 * loading card holds this many rows' place. A second copy anywhere would hold
 * a place for rows the display then does not draw, which is the jump the
 * reservation exists to prevent.
 *
 * `items` is read through core's own rule, so a missing or garbage setting
 * means what it means to the query: five rows, never NaN.
 */
export function rowsDrawn(tier: SizeTier, items: unknown): number {
  return Math.min(
    effectiveWidgetLimit(items),
    MAX_WIDGET_ROWS,
    tier === "small" ? SMALL_TIER_ROWS : Number.POSITIVE_INFINITY
  );
}

/**
 * How a list or table card lays its rows out at `tier`, given how many columns it has.
 *
 * - `table`: a heading row and the rows, at the large tier when there are columns to head.
 * - `list-detail`: a label and a detail line per row, from the medium tier when there is a second
 *   column to make the detail of.
 * - `list`: label lines only; a small card has room for nothing more.
 *
 * One answer for the rows a card draws and the skeleton that holds their place before they
 * arrive, so the two lay out alike: a skeleton drawn as a list for a card that then draws a
 * table would change height the moment the answer lands.
 */
export type RowsLayout =
  | { kind: "list" }
  | { kind: "list-detail" }
  | { kind: "table"; columns: number };

export function rowsLayout(tier: SizeTier, columns: number): RowsLayout {
  if (tier === "large" && columns > 0) return { kind: "table", columns };
  return tier !== "small" && columns > 1
    ? { kind: "list-detail" }
    : { kind: "list" };
}

/** Where the one card-tier context is kept, across every copy of this module. */
const CARD_TIER_CONTEXT_KEY = Symbol.for("nextly.admin.card-tier-context");

const contexts = globalThis as {
  [CARD_TIER_CONTEXT_KEY]?: Context<SizeTier | undefined>;
};

/**
 * The card-tier context, one for the whole page however many copies of the
 * admin are loaded.
 *
 * 🔴 A plugin that bundles its own copy of the admin, rather than importing the
 * kit through `@nextlyhq/plugin-sdk/admin` with the admin left to the host,
 * would otherwise make a second context: its card states would read the tier
 * of a provider that is never drawn, `undefined`, and draw at the wrong size
 * with nothing saying why. Kept on a global key, the second copy reads the
 * host's, and development says once that a second copy was loaded.
 */
function sharedCardTierContext(): Context<SizeTier | undefined> {
  const existing = contexts[CARD_TIER_CONTEXT_KEY];
  if (existing !== undefined) {
    if (process.env.NODE_ENV !== "production") {
      console.warn(
        "[nextly] A second copy of @nextlyhq/admin's widget kit was loaded. " +
          "A plugin likely bundles the admin: import the kit from " +
          "@nextlyhq/plugin-sdk/admin and leave @nextlyhq/admin to the host."
      );
    }
    return existing;
  }
  const created = createContext<SizeTier | undefined>(undefined);
  contexts[CARD_TIER_CONTEXT_KEY] = created;
  return created;
}

/** The tier of the card being drawn; `undefined` outside a card or before it is measured. */
export const CardTierContext: Context<SizeTier | undefined> =
  sharedCardTierContext();

/** The tier of the card this is drawn in. */
export function useCardTier(): SizeTier | undefined {
  return useContext(CardTierContext);
}

/**
 * The tier the answer a card shows was fetched at; `undefined` where it is not known. A card that
 * grew keeps its smaller answer on screen until a larger one lands, and that answer holds only
 * the rows its own tier asked for, and the one more that says more exist.
 */
export const AnswerTierContext: Context<SizeTier | undefined> = createContext<
  SizeTier | undefined
>(undefined);

const TIER_ORDER: Readonly<Record<SizeTier, number>> = {
  small: 0,
  medium: 1,
  large: 2,
};

/** Whether a card drawn at `tier` draws what is drawn from `from` up. */
export function drawsFrom(tier: SizeTier, from: SizeTier): boolean {
  return TIER_ORDER[tier] >= TIER_ORDER[from];
}

/**
 * The tier a card's rows are counted at: the card's own, or the tier its answer was fetched at
 * when that is smaller. Counted at the card's tier, a smaller answer would draw its extra row as
 * one more item and lose the sign that more exist.
 */
export function useRowsTier(cardTier: SizeTier): SizeTier {
  const answerTier = useContext(AnswerTierContext);
  return answerTier !== undefined &&
    TIER_ORDER[answerTier] < TIER_ORDER[cardTier]
    ? answerTier
    : cardTier;
}

/**
 * Measures the card at `ref` and answers its tier, which the frame then provides.
 *
 * A tier the caller states wins over the measured one, so a card drawn somewhere without a
 * layout of its own -- a preview, a test -- can still be given one.
 */
export function useMeasuredTier(
  ref: RefObject<HTMLElement | null>,
  stated?: SizeTier
): SizeTier | undefined {
  const measured = tierForWidth(useMeasuredWidth(ref));
  return stated ?? measured;
}
