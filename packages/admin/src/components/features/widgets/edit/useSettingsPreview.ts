"use client";

/**
 * The card as the settings sheet's current values would draw it, for the preview beside the form.
 *
 * A setting changes a card in one of two ways, and the preview follows both. It changes how the
 * card is drawn, which the component reads from the card's settings (`placement.settings`); and
 * it can change the question the card asks, as `limit` does. While the question is the one the
 * card already asked, the preview draws the card's own answer and asks nothing. When the values
 * change the question, the preview asks it once, alone, after the reader stops changing them, so
 * a number typed digit by digit is one request, not one per digit.
 *
 * The preview's request is its own card (`<placement>:preview`), never the card's: the card keeps
 * its answer until Done keeps the change, and Cancel leaves it exactly as it was.
 *
 * @module components/features/widgets/edit/useSettingsPreview
 */

import type { SizeTier } from "@nextlyhq/ui/format";
import { useMemo } from "react";

import { useBranding } from "@admin/context/providers/BrandingProvider";
import {
  useWidgetQueries,
  type WidgetQueryRequest,
} from "@admin/hooks/queries/useWidgetQueries";
import { useDebouncedValue } from "@admin/hooks/useDebouncedValue";
import type {
  DashboardWidget,
  WidgetSlot,
} from "@admin/types/dashboard/widgets";

import type { CellSlotLookup } from "../archetypes/types";
import { queryForTier } from "../tier-query";
import { UNSOURCED_SLOT } from "../useWidgetBatch";
import {
  questionOf,
  settingsAsAsked,
  sourcedQuery,
  titleAsAsked,
  widgetAsAsked,
} from "../widget-as-asked";

/** How long the values must stay still before a changed question is asked. */
const PREVIEW_ASK_DELAY_MS = 300;

/**
 * The tier the preview's own question is asked at: the widest. The preview draws at whatever
 * width the sheet gives it, measured only once it renders, and an answer fetched for a wider card
 * serves a narrower one, which draws a prefix of it and still knows more exist (`asksAgainAt`).
 */
const PREVIEW_TIER: SizeTier = "large";

/** What the card itself shows now, which the preview draws while the question is unchanged. */
export interface ShownAnswer {
  slot: WidgetSlot | undefined;
  slotFor?: CellSlotLookup;
  updatedAt: Date | null;
  isFetching: boolean;
  /** The tier that answer was fetched at, for a sized card. */
  answerTier?: SizeTier;
}

export interface SettingsPreview {
  /** The widget as the sheet's values would ask it. */
  definition: DashboardWidget;
  /** The preview's own card id, and the settings its component reads. */
  placement: { id: string; settings: Record<string, unknown> };
  slot: WidgetSlot | undefined;
  slotFor?: CellSlotLookup;
  updatedAt: Date | null;
  /** The preview is waiting for an answer to the question its values ask. */
  isFetching: boolean;
  /** The tier the answer drawn was fetched at, so a list knows whether more exist. */
  answerTier?: SizeTier;
}

/**
 * The preview's own questions for the values the sheet holds: the card as its own card, for one
 * core answers on the server; each cell that applies, for a custom card asking through cells; or
 * its one query. Asked as declared for a custom card, whose own component draws the raw answer
 * with no tier, and sized as the batch sizes a card it draws otherwise.
 */
function previewRequests(
  widget: DashboardWidget,
  definition: DashboardWidget,
  previewId: string,
  draft: Record<string, unknown>
): WidgetQueryRequest[] {
  // A card core answers on the server is asked with the draft settings, as its own card: never
  // the stored card's ask, so its answer is never filed as the stored card's.
  if (widget.serverData === true) {
    return [
      { placementId: previewId, card: { widget: widget.id, settings: draft } },
    ];
  }
  // Every cell that applies, as the widest card draws them: a cell its draft has not given a
  // source asks nothing, as on the dashboard.
  if (definition.cells?.length) {
    return definition.cells.flatMap(cell =>
      sourcedQuery(cell.query)
        ? [{ placementId: previewId, cellKey: cell.key, query: cell.query }]
        : []
    );
  }
  const query = definition.query;
  if (!sourcedQuery(query)) return [];
  if (definition.archetype === "custom") {
    return [{ placementId: previewId, query }];
  }
  return [
    {
      placementId: previewId,
      query,
      sized: { query: queryForTier(query, PREVIEW_TIER), tier: PREVIEW_TIER },
    },
  ];
}

export function useSettingsPreview(args: {
  /** The widget as declared, before any settings apply. */
  widget: DashboardWidget;
  placementId: string;
  /** What the card has stored, which the answer it shows was asked with. */
  stored: Record<string, unknown> | undefined;
  /** The sheet's current values, as `toStoredConfig` builds them. */
  draft: Record<string, unknown>;
  shown: ShownAnswer;
}): SettingsPreview {
  const { widget, placementId, stored, draft, shown } = args;
  const previewId = `${placementId}:preview`;
  // The reader's collections, as the dashboard asks with them: which fields a setting may name,
  // and which cells a collection's lifecycle answers.
  const sources = useBranding().widgetSources;

  const definition = useMemo(() => {
    const asked = widgetAsAsked(widget, draft, sources);
    const title = titleAsAsked(widget, draft, sources);
    return title === asked.title ? asked : { ...asked, title };
  }, [widget, draft, sources]);
  const asking = questionOf(widget, draft, sources);
  const sameQuestion = asking === questionOf(widget, stored, sources);
  // The question settles before it is asked, so a run of changes asks once.
  const settled = useDebouncedValue(asking, PREVIEW_ASK_DELAY_MS);

  // The settled question itself is each request's query, so each new question is a new one.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      sameQuestion || settled !== asking
        ? []
        : previewRequests(widget, definition, previewId, draft),
    [sameQuestion, settled, asking, definition, previewId, widget, draft]
  );
  const asked = useWidgetQueries(requests);

  const placement = useMemo(
    () => ({
      id: previewId,
      settings: settingsAsAsked(widget, draft, sources),
    }),
    [previewId, widget, draft, sources]
  );

  // The changed question's cell answers, once asked; see `previewCellLookup`.
  const ready = settled === asking;
  const previewCells = asked.cellSlots[previewId];
  const slotFor = useMemo(
    () => previewCellLookup(definition.cells, previewCells, ready),
    [definition.cells, previewCells, ready]
  );

  if (sameQuestion) return shownPreview(definition, placement, shown);
  return {
    definition,
    placement,
    // Nothing until the changed question is answered: the card's own answer was asked another
    // way, and drawing it here would preview what the change does not show.
    slot: ready ? asked.slots[previewId] : undefined,
    ...(slotFor === undefined ? {} : { slotFor }),
    updatedAt: ready ? asked.updatedAt : null,
    isFetching: !ready || asked.fetchingPlacementIds.has(previewId),
    // Only an answer asked sized has a tier: a custom card's and a server card's were not.
    ...(definition.archetype === "custom" || widget.serverData === true
      ? {}
      : { answerTier: PREVIEW_TIER }),
  };
}

/**
 * A cells card's answers for the preview, by key: a cell that asks nothing is not available, as
 * on the dashboard, and the rest are on their way until the preview's own question is answered.
 * `undefined` for a card with no cells.
 */
function previewCellLookup(
  cells: DashboardWidget["cells"],
  answers: Record<string, WidgetSlot> | undefined,
  ready: boolean
): CellSlotLookup | undefined {
  if (!cells?.length) return undefined;
  const unsourced = new Set(
    cells.filter(cell => !sourcedQuery(cell.query)).map(cell => cell.key)
  );
  return key => {
    if (unsourced.has(key)) return UNSOURCED_SLOT;
    return ready ? answers?.[key] : undefined;
  };
}

/** The preview while its question is the card's own: the card's answer, as the card shows it. */
function shownPreview(
  definition: DashboardWidget,
  placement: SettingsPreview["placement"],
  shown: ShownAnswer
): SettingsPreview {
  return {
    definition,
    placement,
    slot: shown.slot,
    ...(shown.slotFor === undefined ? {} : { slotFor: shown.slotFor }),
    updatedAt: shown.updatedAt,
    isFetching: shown.isFetching,
    ...(shown.answerTier === undefined ? {} : { answerTier: shown.answerTier }),
  };
}
