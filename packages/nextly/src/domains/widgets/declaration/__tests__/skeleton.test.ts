/**
 * A declaration's `skeleton`: checked at startup like every other field, and
 * published as the registry's `sketch`, the one value the admin draws both a
 * card's loading state and its add-panel row from.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { clearWidgets, getWidget } from "../../registry";
import {
  clearDeclaredWidgets,
  registerDashboardWidgets,
} from "../declared-widgets";
import { defineWidget } from "../define-widget";
import { WIDGET_SKELETON_SKETCH } from "../skeleton";
import { widgetDeclarationFaults } from "../validate";

beforeEach(() => {
  clearWidgets();
});

afterEach(() => {
  clearDeclaredWidgets();
});

const shaped = (skeleton?: unknown) => ({
  ...defineWidget({
    id: "acme/orders",
    title: "Orders",
    description: "How many orders there are",
    size: { default: { w: 4, h: 2 } },
    load: async () => ({ total: 3 }),
    view: "figure",
  }),
  ...(skeleton === undefined ? {} : { skeleton }),
});

describe("a declaration's skeleton", () => {
  it.each(Object.keys(WIDGET_SKELETON_SKETCH))("accepts %s", skeleton => {
    expect(widgetDeclarationFaults(shaped(skeleton), "acme")).toEqual([]);
  });

  it.each([["spinner"], [""], [3], [null]])(
    "refuses %s, naming the shapes it may be",
    skeleton => {
      const faults = widgetDeclarationFaults(shaped(skeleton), "acme");
      expect(faults.map(fault => fault.problem)).toEqual([
        expect.stringContaining(
          "skeleton must be one of figure, list, bars, series, table"
        ),
      ]);
    }
  );

  it("is published as the sketch the admin draws its loading state and its row with", () => {
    registerDashboardWidgets({
      groups: [{ owner: "acme", declarations: [shaped("series")] }],
    });
    expect(getWidget("acme/orders")?.sketch).toBe("timeseries");
  });

  it("publishes no sketch for a declaration that states none", () => {
    registerDashboardWidgets({
      groups: [{ owner: "acme", declarations: [shaped()] }],
    });
    expect(getWidget("acme/orders")).not.toHaveProperty("sketch");
  });
});
