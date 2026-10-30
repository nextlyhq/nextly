/**
 * A fixture plugin whose one card's data takes as long as a test says, so
 * e2e/tests/dashboard-slow-card.spec.ts can prove a slow card holds no other:
 * every card reading another source is drawn while this one is still waiting.
 *
 * Registered only when `NEXTLY_E2E_SLOW_WIDGET=1`, which the e2e server sets,
 * for the reason the style fixture is: in a contributor's `pnpm dev:app` it is
 * a test double listed among real plugins. Its delay is 0 until the spec sets
 * one through `POST /api/e2e/slow-widget`, so the other dashboard specs that
 * share the server see an ordinary card.
 */
import { definePlugin, defineWidget } from "@nextlyhq/plugin-sdk";

import { slowWidgetDelayMs } from "./delay";

/** Waits `ms`, or stops at once when `signal` aborts, as a well-behaved load does. */
function wait(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}

/**
 * The slow card: a figure whose `load` answers after the delay the spec set,
 * drawn by core's figure view, so it needs no component of its own.
 */
const slowWidget = defineWidget({
  id: "slow-widget-fixture/slow",
  title: "Slow fixture",
  description: "A count that answers as late as the test asks",
  // Core's size for a widget that states none (`UNSTATED_WIDGET_SIZE`): the
  // card takes a full row of the default dashboard the other specs share.
  size: { default: { w: 12, h: 4 }, min: { w: 3, h: 2 }, max: { w: 12, h: 6 } },
  load: async ({ signal }) => {
    await wait(slowWidgetDelayMs(), signal);
    return { total: 42 };
  },
  view: "figure",
});

export const slowWidgetFixturePlugin = definePlugin({
  name: "slow-widget-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    dashboard: {
      widgets: [slowWidget],
      // On the default dashboard, so the slow-card spec finds it beside
      // every other card without placing it.
      suggest: ["slow-widget-fixture/slow"],
    },
  },
});
