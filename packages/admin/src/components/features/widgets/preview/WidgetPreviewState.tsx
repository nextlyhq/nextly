"use client";

/**
 * One drawn state of one widget at one size: the dashboard's own card, handed
 * the answer that state is drawn from, with its accessibility findings beside
 * it.
 *
 * The card is the dashboard's `WidgetRenderer`, so the frame, the archetype
 * body and a widget's own component draw here exactly as on the dashboard. It
 * is drawn at the size's own width (its span of the twelve columns, inside a
 * container the spans answer to) and height (`cardHeightPx`).
 *
 * @module components/features/widgets/preview/WidgetPreviewState
 */

import type { GridSize } from "nextly/config";
import type { JSX, ReactNode } from "react";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { cardHeightPx, cardSpanClass } from "../sizes";
import { WidgetRenderer } from "../WidgetRenderer";

import { StateFindings } from "./preview-findings";
import {
  cardShows,
  PREVIEW_STATE_LABELS,
  type PreviewAnswer,
  type PreviewStateName,
} from "./preview-states";

/** What a state says in the card's place when the card does not reach it. */
export const NOT_REACHED =
  "This card does not show this state: it asks for no data, or draws this state itself.";

/** What a ready state says for a widget that declares no preview case. */
export const NO_PREVIEW_CASE =
  "No preview case: this widget declares none, so its ready state is not drawn.";

export interface WidgetPreviewStateProps {
  /** Unique on the page: names the card and keys its findings. */
  stateKey: string;
  definition: DashboardWidget;
  state: PreviewStateName;
  size: GridSize;
  /** The answer to draw from, or `undefined` for a ready state with no case. */
  answer: PreviewAnswer | undefined;
  /** The case drawn, for a ready state. */
  caseName?: string;
  settings?: Record<string, unknown>;
}

/** The note drawn in a card's place, at the card's own size. */
function InPlaceOfCard({
  children,
  testId,
}: {
  children: ReactNode;
  testId: string;
}): JSX.Element {
  return (
    <div
      className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-4 text-center text-sm text-muted-foreground"
      data-testid={testId}
    >
      {children}
    </div>
  );
}

export function WidgetPreviewState({
  stateKey,
  definition,
  state,
  size,
  answer,
  caseName,
  settings,
}: WidgetPreviewStateProps): JSX.Element {
  const label =
    caseName === undefined
      ? PREVIEW_STATE_LABELS[state]
      : `${PREVIEW_STATE_LABELS[state]}: ${caseName}`;
  // Asked of the dashboard's own outcome before anything is mounted, so a card
  // that would draw this state itself, with live data, is never mounted here.
  const drawn =
    answer !== undefined && cardShows(definition, state, answer)
      ? answer
      : undefined;

  return (
    <div
      className={`${cardSpanClass(size.w)} flex min-w-0 flex-col gap-2`}
      data-preview-key={stateKey}
      data-preview-widget={definition.id}
      data-preview-state={state}
      data-preview-size={`${size.w}x${size.h}`}
      {...(caseName === undefined ? {} : { "data-preview-case": caseName })}
    >
      <p className="text-xs font-medium text-muted-foreground">{label}</p>
      <div data-preview-card style={{ height: cardHeightPx(size.h) }}>
        {drawn !== undefined ? (
          <WidgetRenderer
            definition={definition}
            slot={drawn.slot}
            slotFor={drawn.slotFor}
            placement={{ id: stateKey, settings: settings ?? {}, size }}
          />
        ) : answer === undefined ? (
          <InPlaceOfCard testId="no-preview-case">
            {NO_PREVIEW_CASE}
          </InPlaceOfCard>
        ) : (
          <InPlaceOfCard testId="state-not-reached">
            {NOT_REACHED}
          </InPlaceOfCard>
        )}
      </div>
      <StateFindings stateKey={stateKey} />
    </div>
  );
}
