"use client";

/**
 * A widget drawn small, for its tile in the add gallery: the dashboard's own card, handed the
 * widget's first declared preview case as its answer, so the tile shows what the card looks like
 * with the widget's own view, never a picture of it.
 *
 * The card is drawn at twice the tile's width and height and scaled to half, so it reads as the
 * card it is rather than as a card squeezed into a tile. It is shown, not used: it is hidden from
 * assistive technology (the tile's own name and description say what it is) and out of reach of
 * the pointer and the keyboard, since its links would act on sample data.
 *
 * A widget that declares no case, or one this admin cannot draw, shows its sketch instead: the
 * icon for the shape its card loads as.
 *
 * @module components/features/widgets/preview/WidgetTilePreview
 */

import type { WidgetResult } from "nextly/widget-result";
import type { JSX } from "react";

import * as Icons from "@admin/components/icons";
import { useBranding } from "@admin/context/providers/BrandingProvider";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { settingsAsAsked } from "../widget-as-asked";
import { WidgetRenderer } from "../WidgetRenderer";

import { readyAnswer } from "./preview-states";

/**
 * The icon each sketch, or archetype, is drawn with when there is no case to draw: one for each
 * display a card is drawn as, and any other as the grid's.
 */
const SKETCHES: Readonly<Record<string, Icons.LucideIcon>> = {
  metric: Icons.Hash,
  figure: Icons.Hash,
  list: Icons.List,
  rows: Icons.List,
  table: Icons.Table,
  timeseries: Icons.TrendingUp,
  series: Icons.TrendingUp,
  bars: Icons.Activity,
  custom: Icons.Puzzle,
};

export interface WidgetTilePreviewProps {
  /** The widget as this admin draws it; `undefined` when it holds no declaration for it. */
  widget: DashboardWidget | undefined;
  /** The widget's first preview case, as its card carries an answer. */
  preview?: { result: WidgetResult; settings?: Record<string, unknown> };
  /** The settings the case is drawn with beyond its own: the collection a new card starts on. */
  settings?: Record<string, unknown>;
}

/** The sketch drawn in place of a preview. */
function Sketch({ kind }: { kind: string | undefined }): JSX.Element {
  const Icon = SKETCHES[kind ?? ""] ?? Icons.LayoutGrid;
  return (
    <div
      className="flex h-full items-center justify-center text-muted-foreground"
      data-testid="tile-sketch"
    >
      <Icon aria-hidden className="size-6" />
    </div>
  );
}

export function WidgetTilePreview({
  widget,
  preview,
  settings,
}: WidgetTilePreviewProps): JSX.Element {
  const sources = useBranding().widgetSources;
  const answer =
    preview === undefined ? undefined : readyAnswer(preview.result);
  return (
    <div
      aria-hidden="true"
      inert
      className="pointer-events-none relative h-28 overflow-hidden rounded-md border border-border bg-muted/40"
      data-testid="tile-preview"
    >
      {widget !== undefined && answer !== undefined ? (
        <div className="absolute left-0 top-0 h-[200%] w-[200%] origin-top-left scale-50 p-1">
          <WidgetRenderer
            definition={widget}
            slot={answer.slot}
            // The case's settings over the starting collection, over the widget's defaults, as a
            // card on the dashboard is handed them.
            placement={{
              id: `tile:${widget.id}`,
              settings: settingsAsAsked(
                widget,
                { ...settings, ...preview?.settings },
                sources
              ),
            }}
          />
        </div>
      ) : (
        <Sketch kind={widget?.sketch ?? widget?.archetype} />
      )}
    </div>
  );
}
