/**
 * `@nextlyhq/admin/testing`: a widget's card drawn as the dashboard draws it,
 * for tests. For tests; never imported by the admin itself.
 *
 * The card is resolved from the widget's published definition by the admin's
 * own `resolveDashboardWidgets` and drawn by its own `WidgetRenderer` inside
 * the real frame, so a test sees what a reader would, in each state the
 * card's answer can put it in.
 *
 * @module testing
 * @experimental Until the widget SDK's test helpers settle.
 */
import type { WidgetDefinition } from "nextly/config";
import type { WidgetSlot } from "nextly/widget-result";
import type { ComponentType, JSX } from "react";

import { resolveDashboardWidgets } from "./components/features/widgets/resolve-widgets";
import { WidgetRenderer } from "./components/features/widgets/WidgetRenderer";
import { registerComponent } from "./lib/plugins/component-registry";

/**
 * A card's grid size, `w` columns by `h` rows, and the tier the dashboard's
 * width draws it at, medium when left out.
 */
interface CardSize {
  w: number;
  h: number;
  tier?: "small" | "medium" | "large";
}

export interface WidgetCardElementOptions {
  /** The widget as the registry publishes it. */
  definition: WidgetDefinition;
  /** What the card is drawn with: its answer, or none while it loads. */
  slot: WidgetSlot | undefined;
  /** The card's size; the widget's starting size when left out. */
  size?: CardSize;
  /** The colour scheme the card is drawn in. */
  theme?: "light" | "dark";
  /** The component a view of the widget's own draws with, registered at its path. */
  component?: ComponentType<never>;
}

/**
 * The element a test renders: the card inside the frame, in the admin's own
 * scope and the theme given.
 */
export function widgetCardElement(
  options: WidgetCardElementOptions
): JSX.Element {
  const { definition } = options;
  if (options.component !== undefined && definition.component !== undefined) {
    registerComponent(definition.component, options.component);
  }
  const [widget] = resolveDashboardWidgets([definition], () => true);
  if (widget === undefined) {
    throw new Error(`widgetCardElement: ${definition.id} could not be drawn`);
  }
  const size = options.size ?? definition.size?.default;
  return (
    <div
      className={`nextly-admin${options.theme === "dark" ? " dark" : ""}`}
      data-theme={options.theme ?? "light"}
    >
      <WidgetRenderer
        definition={widget}
        slot={options.slot}
        answerSize={{
          tier: options.size?.tier ?? "medium",
          ...(size === undefined ? {} : { h: size.h }),
        }}
      />
    </div>
  );
}
