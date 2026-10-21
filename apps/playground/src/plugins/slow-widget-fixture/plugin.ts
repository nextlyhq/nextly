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
import { definePlugin } from "@nextlyhq/plugin-sdk";

import { slowWidgetDelayMs } from "./delay";

export const SLOW_WIDGET_SOURCE_ID = "plugin:slow-widget-fixture/slow";

/** Waits `ms`, or stops at once when `signal` aborts, as a well-behaved resolver does. */
function wait(ms: number, signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (ms <= 0) return resolve();
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => {
      clearTimeout(timer);
      reject(new Error("aborted"));
    });
  });
}

export const slowWidgetFixturePlugin = definePlugin({
  name: "slow-widget-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    widgetSources: [
      {
        source: {
          id: SLOW_WIDGET_SOURCE_ID,
          label: "Slow fixture",
          kind: "plugin",
          supports: ["count"],
          fields: [{ name: "total", type: "number" }],
        },
        resolve: async (_query, _caller, _ctx, opts) => {
          await wait(slowWidgetDelayMs(), opts?.signal);
          return { op: "count" as const, total: 42 };
        },
      },
    ],
    admin: {
      widgets: [
        {
          id: "slow-widget-fixture/slow",
          archetype: "metric",
          title: "Slow fixture",
          description: "A count that answers as late as the test asks",
          query: { source: SLOW_WIDGET_SOURCE_ID, op: "count" },
        },
      ],
    },
  },
});
