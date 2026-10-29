/**
 * `@nextlyhq/plugin-sdk/testing/admin`: a widget's card drawn as the dashboard
 * draws it, for a test to render, in any state the card can be in.
 *
 * ```tsx
 * import { render } from "@testing-library/react";
 * import { renderWidgetCard } from "@nextlyhq/plugin-sdk/testing/admin";
 *
 * render(renderWidgetCard(ordersWidget, { state: "ready", data: { total: 3 } }));
 * // or what a load answered, as runWidgetLoad returns it:
 * render(renderWidgetCard(ordersWidget, { result: await runWidgetLoad(t, ordersWidget, { as }) }));
 * ```
 *
 * The card is described as the registry publishes the widget and drawn by the
 * admin's own renderer inside the real frame; for tests, never production.
 *
 * @experimental Until the widget SDK's test helpers settle.
 */
import { widgetCardElement } from "@nextlyhq/admin/testing";
import type { AnyWidget, WidgetData } from "nextly";
import {
  publishedWidgetDefinition,
  widgetCardSlot,
  type WidgetLoadResult,
} from "nextly/testing";
import type { ComponentType, JSX } from "react";

/** A card's states: each a load can answer, and `loading`, which only a card shows. */
export type WidgetCardState = WidgetLoadResult<unknown>["state"] | "loading";

/** The card a hand-made case draws: a state, and what that state carries. */
type HandMade<W> =
  | { state: "loading" }
  | { state: "ready" | "empty"; data: WidgetData<W> }
  | { state: "needs-setting"; setting: string }
  | { state: "unavailable" | "not-shown" }
  | { state: "error"; error: string };

export type RenderWidgetCardOptions<W> = (
  | { result: WidgetLoadResult<W> }
  | HandMade<W>
) & {
  /** The card's size, and the tier it is drawn at; the widget's starting size when left out. */
  size?: { w: number; h: number; tier?: "small" | "medium" | "large" };
  /** The colour scheme the card is drawn in; light when left out. */
  theme?: "light" | "dark";
  /** The component a view of the widget's own draws with. */
  component?: ComponentType<never>;
};

/** The card's element, for a test to render with its own renderer. */
export function renderWidgetCard<W extends AnyWidget>(
  widget: W,
  options: RenderWidgetCardOptions<W>
): JSX.Element {
  const shown: WidgetLoadResult<W> | { state: "loading" } =
    "result" in options ? options.result : options;
  return widgetCardElement({
    definition: publishedWidgetDefinition(widget),
    slot: widgetCardSlot(widget, shown),
    ...(options.size === undefined ? {} : { size: options.size }),
    ...(options.theme === undefined ? {} : { theme: options.theme }),
    ...(options.component === undefined
      ? {}
      : { component: options.component }),
  });
}
