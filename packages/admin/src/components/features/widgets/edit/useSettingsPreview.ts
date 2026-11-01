"use client";

/**
 * The card as the settings sheet's current values would draw it, for the preview beside the form.
 *
 * A setting changes a card in one of two ways, and the preview follows both. It changes how the
 * card is drawn, which the component reads from the card's settings (`placement.settings`); and
 * it changes the question the card asks, since its widget's `load` reads the settings too. While
 * the question is the one the card already asked, the preview draws the card's own answer and
 * asks nothing. When the values change the question, the preview asks it once, alone, after the
 * reader stops changing them, so a number typed digit by digit is one request, not one per digit.
 *
 * The preview's request is its own card (`<placement>:preview`) asked with the sheet's values,
 * never the stored card's: the card keeps its answer until Done keeps the change, and Cancel
 * leaves it exactly as it was.
 *
 * @module components/features/widgets/edit/useSettingsPreview
 */

import type { GridSize } from "nextly/config";
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

import { questionOf, settingsAsAsked, titleAsAsked } from "../widget-as-asked";

/** How long the values must stay still before a changed question is asked. */
const PREVIEW_ASK_DELAY_MS = 300;

/** What the card itself shows now, which the preview draws while the question is unchanged. */
export interface ShownAnswer {
  slot: WidgetSlot | undefined;
  updatedAt: Date | null;
  isFetching: boolean;
}

export interface SettingsPreview {
  /** The widget as the sheet's values would ask it. */
  definition: DashboardWidget;
  /** The widget's own name under the title, when the title names the card's subject. */
  subtitle?: string;
  /** The preview's own card id, the settings its component reads, and the size it is drawn at. */
  placement: { id: string; settings: Record<string, unknown>; size?: GridSize };
  slot: WidgetSlot | undefined;
  /** The preview is waiting for an answer to the question its values ask. */
  isFetching: boolean;
}

/**
 * The preview's own question for the values the sheet holds: the card as its own card, asked
 * with the draft settings, never the stored card's ask, so its answer is never filed as the
 * stored card's.
 */
function previewRequests(
  widget: DashboardWidget,
  previewId: string,
  draft: Record<string, unknown>
): WidgetQueryRequest[] {
  return [
    { placementId: previewId, card: { widget: widget.id, settings: draft } },
  ];
}

/** The preview's own card, the settings its component reads, and the size it is drawn at. */
function usePreviewPlacement(args: {
  previewId: string;
  widget: DashboardWidget;
  draft: Record<string, unknown>;
  sources: ReturnType<typeof useBranding>["widgetSources"];
  size: GridSize | undefined;
}): SettingsPreview["placement"] {
  const { previewId, widget, draft, sources, size } = args;
  return useMemo(
    () => ({
      id: previewId,
      settings: settingsAsAsked(widget, draft, sources),
      ...(size === undefined ? {} : { size }),
    }),
    [previewId, widget, draft, sources, size]
  );
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
  /** The title the panel holds for the card, its reader's own; empty for the automatic one. */
  ownTitle?: string;
  /** The size the card is drawn at on the dashboard, held to its widget's bounds. */
  size?: GridSize;
}): SettingsPreview {
  const { widget, placementId, stored, draft, shown } = args;
  const previewId = `${placementId}:preview`;
  // The reader's collections, as the dashboard reads settings against them: which fields a
  // setting may name.
  const sources = useBranding().widgetSources;

  const heading = useMemo(
    () => titleAsAsked(widget, draft, sources, args.ownTitle),
    [widget, draft, sources, args.ownTitle]
  );
  // The widget under the title the sheet's values give the card.
  const definition = useMemo(
    () =>
      heading.title === widget.title
        ? widget
        : { ...widget, title: heading.title },
    [widget, heading.title]
  );
  const subtitle =
    heading.subtitle === undefined ? {} : { subtitle: heading.subtitle };
  // What the card asks with the sheet's values, and with its stored ones: its settings are what
  // its widget's `load` reads, so any change of them, its density included, is a new question.
  const asking = questionOf(draft);
  const sameQuestion = asking === questionOf(stored);
  // The question settles before it is asked, so a run of changes asks once.
  const settled = useDebouncedValue(asking, PREVIEW_ASK_DELAY_MS);

  const placement = usePreviewPlacement({
    previewId,
    widget,
    draft,
    sources,
    size: args.size,
  });

  // The settled settings themselves are the request's card, so each new question is a new one.
  const requests = useMemo<WidgetQueryRequest[]>(
    () =>
      sameQuestion || settled !== asking
        ? []
        : previewRequests(widget, previewId, draft),
    [sameQuestion, settled, asking, previewId, widget, draft]
  );
  const asked = useWidgetQueries(requests);
  const ready = settled === asking;

  if (sameQuestion) {
    return { ...shownPreview(definition, placement, shown), ...subtitle };
  }
  return {
    definition,
    ...subtitle,
    placement,
    // Nothing until the changed question is answered: the card's own answer was asked another
    // way, and drawing it here would preview what the change does not show.
    slot: ready ? asked.slots[previewId] : undefined,
    isFetching: !ready || asked.fetchingPlacementIds.has(previewId),
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
    isFetching: shown.isFetching,
  };
}
