/**
 * `renderWidgetCard`: the card a load answered, or a state a test names, handed
 * to the admin's own card builder as the dashboard would describe and answer
 * it. The builder is captured here; its drawing is the admin's own test.
 */
import { defineWidget } from "nextly";
import { describe, expect, it, vi } from "vitest";

const drawn: unknown[] = [];
vi.mock("@nextlyhq/admin/testing", () => ({
  widgetCardElement: (options: unknown) => {
    drawn.push(options);
    return null;
  },
}));

import { renderWidgetCard } from "./admin";

const openOrders = defineWidget({
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  size: { default: { w: 6, h: 3 } },
  load: async () => ({ total: 0 }),
  view: "figure",
});

const last = () => drawn.at(-1) as Record<string, unknown>;

describe("a widget's card for a test", () => {
  it("is described as the registry publishes the widget", () => {
    renderWidgetCard(openOrders, { state: "loading" });
    expect(last().definition).toMatchObject({
      id: "acme/open-orders",
      archetype: "metric",
      serverData: true,
    });
    expect(last().slot).toBeUndefined();
  });

  it("draws what a load answered, as the route would carry it", () => {
    renderWidgetCard(openOrders, {
      result: { state: "ready", data: { total: 3 } },
      theme: "dark",
      size: { w: 12, h: 3 },
    });
    expect(last()).toMatchObject({
      slot: { ok: true, result: { op: "count", total: 3 } },
      theme: "dark",
      size: { w: 12, h: 3 },
    });
  });

  it("draws a hand-made state the same way as a load's", () => {
    renderWidgetCard(openOrders, { state: "unavailable" });
    const handMade = last().slot;
    renderWidgetCard(openOrders, { result: { state: "unavailable" } });
    expect(last().slot).toEqual(handMade);
    expect(handMade).toMatchObject({ ok: false, code: "unavailable" });
  });
});
