"use client";

/**
 * A widget declared with `defineWidget` and drawn by its own component, inside
 * the frame: the component is handed the props its declaration types
 * (`WidgetProps`), and a throw while drawing is that card's error alone.
 *
 * Drawn only once the card has data: the frame has already drawn loading, no
 * permission and error by then (`resolveWidgetOutcome`'s `answered`), so the
 * component never decides what an absent answer looks like.
 *
 * @module components/features/widgets/declared-component
 */

import type {
  DeclaredComponentProps,
  WidgetRenderSize,
  WidgetSlot,
} from "nextly/widget-result";
import { useCallback, useContext, useEffect, useState, type JSX } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { DrawFailureContext } from "./draw-failures";
import { useCardTier } from "./frame/tier";

/** The body while the component fails: nothing, as the frame draws the error. */
function NothingDrawn(): null {
  return null;
}

/** A number per answer, so a new answer draws in a new boundary. */
const answerIds = new WeakMap<object, number>();
let lastAnswerId = 0;

function answerId(slot: WidgetSlot | undefined): number {
  if (slot === undefined) return 0;
  let id = answerIds.get(slot);
  if (id === undefined) {
    lastAnswerId += 1;
    id = lastAnswerId;
    answerIds.set(slot, id);
  }
  return id;
}

/**
 * Whether a card's own component threw while drawing its answer, and the
 * Retry that draws it again.
 *
 * 🔴 A throw belongs to the answer it was drawn from. A new answer is drawn in
 * a new boundary, and so is each Retry, but only once the answer it asked for
 * has SETTLED: remounted on the click, the component would meet the same
 * answer that broke it and fail again before the new one arrived, and stay
 * failed after. Without a refetch to wait for, Retry draws again at once.
 *
 * The grid is told, so it counts the card as failed while it is.
 */
export function useComponentDraw({
  slot,
  isFetching,
  onRetry,
  placementId,
}: {
  slot: WidgetSlot | undefined;
  isFetching: boolean;
  onRetry?: () => void;
  placementId: string;
}): {
  failed: boolean;
  drawKey: string;
  caught: () => void;
  retry: () => void;
} {
  const report = useContext(DrawFailureContext);
  const [failedOn, setFailedOn] = useState<{
    slot: WidgetSlot | undefined;
  } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [retrying, setRetrying] = useState<"asked" | "fetching" | null>(null);
  const failed = failedOn !== null && failedOn.slot === slot;

  useEffect(() => {
    if (retrying === "asked" && isFetching) setRetrying("fetching");
    if (retrying === "fetching" && !isFetching) {
      setRetrying(null);
      setFailedOn(null);
      setAttempt(count => count + 1);
    }
  }, [retrying, isFetching]);

  useEffect(() => {
    report?.(placementId, failed);
  }, [report, placementId, failed]);
  // A card that leaves the grid takes its failure with it.
  useEffect(() => () => report?.(placementId, false), [report, placementId]);

  const caught = useCallback(() => setFailedOn({ slot }), [slot]);
  const retry = useCallback(() => {
    if (onRetry === undefined) {
      setFailedOn(null);
      setAttempt(count => count + 1);
      return;
    }
    setRetrying("asked");
    onRetry();
  }, [onRetry]);

  return {
    failed,
    drawKey: `${answerId(slot)}:${attempt}`,
    caught,
    retry,
  };
}

export function DeclaredComponent({
  definition,
  placement,
  data,
  refreshing,
  onRetry,
  onCaught,
}: {
  definition: DashboardWidget;
  placement:
    | {
        id: string;
        settings: Record<string, unknown>;
        width?: WidgetRenderSize["width"];
      }
    | undefined;
  data: unknown;
  refreshing: boolean;
  onRetry?: () => void;
  /** Told when the component throws, so the frame draws its error state. */
  onCaught: () => void;
}): JSX.Element {
  // The tier the frame measured; medium for the one frame before it has, so
  // the component draws and then follows the card's real size as it changes.
  const tier = useCardTier() ?? "medium";
  const props: DeclaredComponentProps = {
    widgetId: definition.id,
    placementId: placement?.id ?? definition.id,
    settings: placement?.settings ?? {},
    // Half where nothing says, as a card drawn outside an arrangement is.
    size: { width: placement?.width ?? "half", class: tier },
    data,
    refreshing,
    // The component's own way to ask again: a refetch, as the frame's is.
    retry: onRetry ?? (() => undefined),
  };
  // Nothing in the body while it fails: the frame draws the card's error
  // state around it, with its Retry (`useComponentDraw`).
  return (
    <PluginSlot
      path={definition.component}
      props={props}
      errorFallback={<NothingDrawn />}
      onError={onCaught}
    />
  );
}
