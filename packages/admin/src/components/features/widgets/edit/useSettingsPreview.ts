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
import { resolveWidgetSettings } from "nextly/config";
import { useMemo } from "react";

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
import { widgetAsAsked } from "../widget-as-asked";

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

/** The query a widget asks with `config`, as one comparable value. */
function askedWith(
  widget: DashboardWidget,
  config: Record<string, unknown> | undefined
): string {
  return JSON.stringify(widgetAsAsked(widget, config).query ?? null);
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

  const definition = useMemo(
    () => widgetAsAsked(widget, draft),
    [widget, draft]
  );
  const asking = askedWith(widget, draft);
  const sameQuestion = asking === askedWith(widget, stored);
  // The question settles before it is asked, so a run of changes asks once.
  const settled = useDebouncedValue(asking, PREVIEW_ASK_DELAY_MS);

  const requests = useMemo<WidgetQueryRequest[]>(() => {
    if (sameQuestion || settled !== asking || !definition.query) return [];
    // The settled question itself is the request's query, so each new question is a new one.
    // Sized as the batch sizes a card it draws, and asked as declared for a custom card, whose
    // own component draws the raw answer with no tier.
    if (definition.archetype === "custom") {
      return [{ placementId: previewId, query: definition.query }];
    }
    return [
      {
        placementId: previewId,
        query: definition.query,
        sized: {
          query: queryForTier(definition.query, PREVIEW_TIER),
          tier: PREVIEW_TIER,
        },
      },
    ];
  }, [sameQuestion, settled, asking, definition, previewId]);
  const asked = useWidgetQueries(requests);

  const placement = useMemo(
    () => ({
      id: previewId,
      settings: resolveWidgetSettings(widget.settings, draft),
    }),
    [previewId, widget.settings, draft]
  );

  if (sameQuestion) {
    return {
      definition,
      placement,
      slot: shown.slot,
      ...(shown.slotFor === undefined ? {} : { slotFor: shown.slotFor }),
      updatedAt: shown.updatedAt,
      isFetching: shown.isFetching,
      ...(shown.answerTier === undefined
        ? {}
        : { answerTier: shown.answerTier }),
    };
  }
  return {
    definition,
    placement,
    // Nothing until the changed question is answered: the card's own answer was asked another
    // way, and drawing it here would preview what the change does not show.
    slot: settled === asking ? asked.slots[previewId] : undefined,
    updatedAt: settled === asking ? asked.updatedAt : null,
    isFetching: settled !== asking || asked.fetchingPlacementIds.has(previewId),
    ...(definition.archetype === "custom" ? {} : { answerTier: PREVIEW_TIER }),
  };
}
