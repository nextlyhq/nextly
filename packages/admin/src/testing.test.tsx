/**
 * The admin's test entry: a widget's card drawn as the dashboard draws it, in
 * each state its answer can put it in, in either colour scheme.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { widgetCardElement } from "./testing";
import type { RegisteredWidgetMeta } from "./types/branding";

/** A figure widget as the registry publishes it. */
const OPEN_ORDERS = {
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  archetype: "metric",
  size: {
    default: { w: 6, h: 3 },
    min: { w: 3, h: 2 },
    max: { w: 12, h: 6 },
  },
} as unknown as RegisteredWidgetMeta;

afterEach(cleanup);

describe("a test's widget card", () => {
  it("draws a ready answer in the card, titled as the dashboard titles it", () => {
    render(
      widgetCardElement({
        definition: OPEN_ORDERS,
        slot: { ok: true, result: { op: "count", total: 7 } },
      })
    );
    const card = screen.getByRole("region", { name: "Open orders" });
    expect(card).toHaveAttribute("data-state", "ready");
    expect(card).toHaveTextContent("7");
  });

  it("draws each state the card can be in", () => {
    const cases = [
      [{ ok: false, error: "x", code: "unavailable" }, "unavailable"],
      [{ ok: false, error: "Boom" }, "error"],
      [undefined, "loading"],
    ] as const;
    for (const [slot, state] of cases) {
      render(widgetCardElement({ definition: OPEN_ORDERS, slot }));
      expect(
        screen.getByRole("region", { name: "Open orders" })
      ).toHaveAttribute("data-state", state);
      cleanup();
    }
  });

  it("asks for a setting the card waits for, rather than failing", () => {
    render(
      widgetCardElement({
        definition: OPEN_ORDERS,
        slot: {
          ok: false,
          error: "No Collection chosen yet",
          code: "needs-setting",
          setting: "Collection",
        },
      })
    );
    // The frame's empty state, asking for the setting by name: an error state
    // would say the load failed, and a ready one would draw nothing to choose.
    const card = screen.getByRole("region", { name: "Open orders" });
    expect(card).toHaveAttribute("data-state", "empty");
    expect(card).toHaveTextContent("Choose collection in the card's settings.");
  });

  it("draws in the dark scheme when asked", () => {
    const { container } = render(
      widgetCardElement({
        definition: OPEN_ORDERS,
        slot: { ok: true, result: { op: "count", total: 7 } },
        theme: "dark",
      })
    );
    expect(container.firstElementChild).toHaveClass("nextly-admin", "dark");
  });
});
