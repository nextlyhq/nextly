"use client";

/**
 * One widget on the preview page: at each of its sizes, its ready state from
 * each preview case, then every frame state.
 *
 * A widget with no case says so where its ready state would be, and still
 * draws every other state. Sizes that coincide (a widget whose smallest size
 * is its default) are drawn once, named for each end they are.
 *
 * @module components/features/widgets/preview/WidgetPreviewSection
 */

import type { GridSize } from "nextly/config";
import { useId, type JSX } from "react";

import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { GRID_COLUMNS_CLASS, sizeName } from "../sizes";

import {
  FRAME_STATES,
  frameAnswer,
  readyAnswer,
  type PreviewStateName,
} from "./preview-states";
import type { WidgetPreview } from "./types";
import { WidgetPreviewState } from "./WidgetPreviewState";

/** What the admin says when it holds no declaration to draw a listed widget with. */
const NOT_DRAWN_HERE =
  "This admin holds no declaration for this widget, so it cannot be drawn here.";

/** One size to draw, named for every end of the bounds it is. */
interface NamedSize {
  label: string;
  size: GridSize;
}

/** The widget's smallest, default and largest sizes, each drawn once. */
export function previewSizes(bounds: WidgetPreview["size"]): NamedSize[] {
  const ends: [string, GridSize][] = [
    ["Smallest", bounds.min],
    ["Default", bounds.default],
    ["Largest", bounds.max],
  ];
  const sizes: NamedSize[] = [];
  for (const [label, size] of ends) {
    const same = sizes.find(
      named => named.size.w === size.w && named.size.h === size.h
    );
    if (same) same.label = `${same.label} and ${label.toLowerCase()}`;
    else sizes.push({ label, size });
  }
  return sizes;
}

/** The page-unique key of one drawn state. */
function stateKeyOf(
  widgetId: string,
  size: GridSize,
  state: PreviewStateName,
  caseName?: string
): string {
  return [
    "preview",
    widgetId,
    `${size.w}x${size.h}`,
    state,
    ...(caseName === undefined ? [] : [caseName]),
  ].join(":");
}

/** Every state of the widget at one size. */
function StatesAtSize({
  preview,
  definition,
  size,
}: {
  preview: WidgetPreview;
  definition: DashboardWidget;
  size: GridSize;
}): JSX.Element {
  return (
    // The container every card span answers to, as the dashboard's is.
    <div className="@container/dashboard">
      <div className={`grid ${GRID_COLUMNS_CLASS} gap-y-4`}>
        {preview.preview.length === 0 ? (
          <WidgetPreviewState
            stateKey={stateKeyOf(preview.id, size, "ready")}
            definition={definition}
            state="ready"
            size={size}
            answer={undefined}
          />
        ) : (
          preview.preview.map(entry => (
            <WidgetPreviewState
              key={entry.name}
              stateKey={stateKeyOf(preview.id, size, "ready", entry.name)}
              definition={definition}
              state="ready"
              size={size}
              answer={readyAnswer(entry.result)}
              caseName={entry.name}
              {...(entry.settings === undefined
                ? {}
                : { settings: entry.settings })}
            />
          ))
        )}
        {FRAME_STATES.map(state => (
          <WidgetPreviewState
            key={state}
            stateKey={stateKeyOf(preview.id, size, state)}
            definition={definition}
            state={state}
            size={size}
            answer={frameAnswer(state)}
          />
        ))}
      </div>
    </div>
  );
}

export function WidgetPreviewSection({
  preview,
  definition,
}: {
  preview: WidgetPreview;
  /** The admin's own declaration of the widget, which every state is drawn with. */
  definition: DashboardWidget | undefined;
}): JSX.Element {
  const headingId = useId();
  const view =
    typeof preview.view === "string" ? preview.view : preview.view.component;
  return (
    <section
      aria-labelledby={headingId}
      className="space-y-4 rounded-lg border border-border bg-card p-4"
      data-preview-section={preview.id}
      // Who declared it, so a check can hold first-party widgets to its rule.
      {...(preview.owner === undefined
        ? {}
        : { "data-preview-owner": preview.owner })}
    >
      <header className="space-y-1">
        <h2 id={headingId} className="text-base font-semibold text-foreground">
          {preview.title}
        </h2>
        <p className="text-xs text-muted-foreground">
          {preview.id}
          {preview.owner === undefined ? "" : ` · ${preview.owner}`} · {view}
          {preview.empty?.message === undefined
            ? ""
            : ` · Empty: "${preview.empty.message}"`}
        </p>
      </header>
      {definition === undefined ? (
        <p
          className="text-sm text-muted-foreground"
          data-testid="not-drawn-here"
        >
          {NOT_DRAWN_HERE}
        </p>
      ) : (
        previewSizes(preview.size).map(({ label, size }) => (
          <div key={`${size.w}x${size.h}`} className="space-y-2">
            <h3 className="text-sm font-medium text-foreground">
              {label}: {sizeName(size)}
            </h3>
            <StatesAtSize
              preview={preview}
              definition={definition}
              size={size}
            />
          </div>
        ))
      )}
    </section>
  );
}
