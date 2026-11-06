/**
 * `nextly/testing/widget-card`: a widget's card described and answered as the
 * dashboard describes and answers it, for the SDK's card helper to draw.
 *
 * Its own entry rather than `nextly/testing`. That entry also carries the
 * test instance, whose graph reaches modules that refuse to load where
 * `window` is defined, so a card test under jsdom importing anything from it
 * failed before a test ran. Nothing here reaches the server, the database or
 * the container; it is on tsdown.config.ts's client-safe list, so the admin's
 * client-bundle-boundary test holds it to that.
 *
 * @module plugins/test-widget-card
 * @experimental Until the widget SDK's test helpers settle.
 */
import { cardAnswerResult } from "../domains/widgets/declaration/card-answer";
import { toDefinition } from "../domains/widgets/declaration/declared-widgets";
import type {
  AnyWidget,
  WidgetData,
} from "../domains/widgets/declaration/define-widget";
import { displayOfView } from "../domains/widgets/declaration/displays";
import type { PublishedWidget, WidgetSlot } from "../domains/widgets/result";
import { UNAVAILABLE_SOURCE_MESSAGE } from "../domains/widgets/sources";

/**
 * What one card answers, in the card's own states: its data, ready or empty;
 * the setting it waits for; not available to this person; not shown to them
 * by its `shows`; or the error its card would show.
 */
export type WidgetLoadResult<W> =
  | { state: "ready"; data: WidgetData<W> }
  | { state: "empty"; data: WidgetData<W> }
  | { state: "needs-setting"; setting: string }
  | { state: "unavailable" }
  | { state: "not-shown" }
  | { state: "error"; error: string };

/**
 * A widget as the registry publishes it to the admin (`PublishedWidget`): what a
 * test draws its card from, so the card is described exactly as the dashboard
 * describes it.
 *
 * @internal For the SDK's test helpers; not a runtime API.
 */
export function publishedWidgetDefinition(
  widget: AnyWidget,
  owner = 'plugin "test"'
): PublishedWidget {
  return toDefinition(
    widget as unknown as Parameters<typeof toDefinition>[0],
    owner
  );
}

/**
 * The answer a card is drawn with for a load result, as the dashboard's route
 * carries it: the data through the server's own `cardAnswerResult`, the other
 * states in the slot each would come back as. `undefined` while it loads.
 *
 * @internal For the SDK's test helpers; not a runtime API.
 */
export function widgetCardSlot<W extends AnyWidget>(
  widget: W,
  result: WidgetLoadResult<W> | { state: "loading" }
): WidgetSlot | undefined {
  switch (result.state) {
    case "loading":
      return undefined;
    case "ready":
    case "empty": {
      const answer = cardAnswerResult(displayOfView(widget.view), result.data, {
        widget: widget.id,
        owner: "test",
      });
      return result.state === "empty"
        ? { ok: true, result: answer, empty: true }
        : { ok: true, result: answer };
    }
    case "needs-setting":
      return {
        ok: false,
        error: `No ${result.setting} chosen yet`,
        code: "needs-setting",
        setting: result.setting,
      };
    case "unavailable":
      return {
        ok: false,
        error: UNAVAILABLE_SOURCE_MESSAGE,
        code: "unavailable",
      };
    case "not-shown":
      return { ok: false, error: "Not shown for you", code: "not-shown" };
    case "error":
      return { ok: false, error: result.error };
  }
}
