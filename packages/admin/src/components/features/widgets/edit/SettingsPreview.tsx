"use client";

/**
 * The card as the settings panel's values would draw it, at the top of the panel: the same
 * renderer the dashboard uses, so what the reader sees is what Done keeps. Shown, not used: its
 * links and controls are out of reach, since the card they would act on is the one behind the
 * panel.
 *
 * Drawn at the card's REAL width and height, and at the tier that width gives it, then scaled
 * down to the panel's width when wider: a full-width card's preview is laid out as the card is,
 * only smaller. The tier is stated rather than measured, because a scaled box measures its
 * scaled width and would read a tier the card does not have.
 *
 * While the panel's filters match nothing, the preview says so, with a way to clear them, rather
 * than drawing the card's empty state, which would read as a card with nothing in it.
 *
 * @module components/features/widgets/edit/SettingsPreview
 */

import { Button } from "@nextlyhq/ui";
import type { GridSize } from "nextly/config";
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

import { useMeasuredWidth } from "@admin/components/shared/preview/useMeasuredWidth";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { tierForWidth } from "../frame/tier";
import { cardHeightPx } from "../sizes";
import { WidgetRenderer } from "../WidgetRenderer";

import { useSettingsPreview, type ShownAnswer } from "./useSettingsPreview";

/** What the preview says while the panel's filters match nothing. */
export const NO_FILTER_MATCH = "No entries match these filters";

/** Whether any Filter setting in `draft` holds a condition. */
export function filtersApplied(
  widget: DashboardWidget,
  draft: Record<string, unknown>
): boolean {
  return (widget.settings ?? []).some(setting => {
    if (setting.type !== "filter") return false;
    const value = draft[setting.name];
    return (
      typeof value === "object" &&
      value !== null &&
      Object.keys(value).length > 0
    );
  });
}

/**
 * The state the card inside `ref` reports (`data-state`), followed as it changes: the frame
 * decides it from the answer, for core's cards and a plugin's alike, so the preview reads it
 * rather than judging the answer a second way.
 */
function useDrawnState(ref: RefObject<HTMLElement | null>): string | null {
  const [state, setState] = useState<string | null>(null);
  useEffect(() => {
    const root = ref.current;
    if (root === null) return undefined;
    const read = () =>
      setState(
        root.querySelector("[data-state]")?.getAttribute("data-state") ?? null
      );
    read();
    const observer = new MutationObserver(read);
    observer.observe(root, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-state"],
    });
    return () => observer.disconnect();
  }, [ref]);
  return state;
}

export function SettingsPreview(props: {
  /** The widget as declared, before any settings apply. */
  widget: DashboardWidget;
  placementId: string;
  stored: Record<string, unknown> | undefined;
  /** The panel's current values, as `toStoredConfig` builds them. */
  draft: Record<string, unknown>;
  /** The title the panel holds for the card; empty for the automatic one. */
  ownTitle: string;
  shown: ShownAnswer;
  /** The size the card is drawn at on the dashboard. */
  size: GridSize;
  /** The width the card is drawn at on the dashboard, in pixels, when it is known. */
  cardWidth: number | undefined;
  /** Empty every Filter setting in the panel. */
  onClearFilters: () => void;
}): JSX.Element {
  const { cardWidth, size } = props;
  const tier = cardWidth === undefined ? undefined : tierForWidth(cardWidth);
  const preview = useSettingsPreview({
    widget: props.widget,
    placementId: props.placementId,
    stored: props.stored,
    draft: props.draft,
    shown: props.shown,
    ownTitle: props.ownTitle,
    size,
    tier,
  });
  // The room the panel gives the preview, against the card's own width: scaled down when the
  // card is wider, never up.
  const roomRef = useRef<HTMLDivElement>(null);
  const room = useMeasuredWidth(roomRef);
  const scale =
    cardWidth === undefined || room === null
      ? 1
      : Math.min(1, room / cardWidth);
  const height = cardHeightPx(size.h);
  const cardRef = useRef<HTMLDivElement>(null);
  const drawnState = useDrawnState(cardRef);
  const noMatch =
    filtersApplied(props.widget, props.draft) && drawnState === "empty";

  return (
    <section
      aria-label={`Preview of ${preview.definition.title}`}
      className="flex flex-col gap-2"
    >
      <p className="text-xs font-medium text-muted-foreground">Preview</p>
      <div
        ref={roomRef}
        className="relative w-full overflow-hidden"
        style={{ height: height * scale }}
        data-testid="settings-preview-room"
      >
        {/* A card shown, not used: its content is out of reach. */}
        <div
          ref={cardRef}
          inert
          aria-hidden={noMatch ? true : undefined}
          data-testid="settings-preview"
          data-scale={scale}
          className={noMatch ? "invisible" : undefined}
          style={{
            ...(cardWidth === undefined ? {} : { width: cardWidth }),
            height,
            transform: scale === 1 ? undefined : `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <WidgetRenderer
            definition={preview.definition}
            placement={preview.placement}
            slot={preview.slot}
            {...(preview.slotFor === undefined
              ? {}
              : { slotFor: preview.slotFor })}
            subtitle={preview.subtitle}
            isFetching={preview.isFetching}
            {...(preview.answerSize === undefined
              ? {}
              : { answerSize: preview.answerSize })}
            {...(tier === undefined ? {} : { tier })}
          />
        </div>
        {noMatch ? (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card p-4 text-center">
            <p role="status" className="text-sm text-foreground">
              {NO_FILTER_MATCH}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={props.onClearFilters}
            >
              Clear filters
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
