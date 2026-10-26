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
} from "nextly/widget-result";
import { useState, type JSX } from "react";

import { PluginSlot } from "@admin/components/shared/plugin-slot";
import type { DashboardWidget } from "@admin/types/dashboard/widgets";

import { CardError } from "./frame/states";
import { useCardTier } from "./frame/tier";

/** What a throw while drawing says, in the card's own words. */
const DREW_NOTHING = "Its component stopped while drawing.";

export function DeclaredComponent({
  definition,
  placement,
  data,
  refreshing,
  onRetry,
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
}): JSX.Element {
  // Counted so Retry after a throw remounts the component: the boundary
  // around it holds its failure until what it draws is new.
  const [attempt, setAttempt] = useState(0);
  // The tier the frame measured; medium for the one frame before it has, so
  // the component draws and then follows the card's real size as it changes.
  const tier = useCardTier() ?? "medium";
  const retry = () => {
    setAttempt(count => count + 1);
    onRetry?.();
  };
  const props: DeclaredComponentProps = {
    widgetId: definition.id,
    placementId: placement?.id ?? definition.id,
    settings: placement?.settings ?? {},
    // Half where nothing says, as a card drawn outside an arrangement is.
    size: { width: placement?.width ?? "half", class: tier },
    data,
    refreshing,
    retry,
  };
  return (
    <PluginSlot
      key={attempt}
      path={definition.component}
      props={props}
      errorFallback={
        <CardError
          message={DREW_NOTHING}
          title={definition.title}
          onRetry={retry}
        />
      }
    />
  );
}
