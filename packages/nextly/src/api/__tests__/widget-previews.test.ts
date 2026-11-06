/**
 * What the development preview read lists for one reader's audience, decided
 * from the declarations startup kept, with no request and no database.
 *
 * The properties pinned are the ones a plausible broken read would get wrong
 * while still listing the right ids: that drawing a case runs none of the
 * widget's server code (its `load`, `shows` and `isEmpty` are spies that must
 * stay silent), that a case reaches the page shaped exactly as its card would
 * carry a real answer, that the cases live on the server alone (the published
 * registry entry the admin reads carries none), and that the empty state's
 * action is offered only where the reader holds its permission. The route's
 * development and production answers, and the audience a real reader is
 * judged into, are `widget-previews.integration.test.ts`'s.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { allWidgets } from "../../domains/widgets/canonical";
import {
  clearDeclaredWidgets,
  registerDashboardWidgets,
} from "../../domains/widgets/declaration/declared-widgets";
import { defineWidget } from "../../domains/widgets/declaration/define-widget";
import { clearWidgets, getWidget } from "../../domains/widgets/registry";
import type { WidgetAudience } from "../../domains/widgets/visibility";
import { widgetPreviewItems } from "../widget-previews";

const load = vi.fn(async () => ({ total: 3 }));
const shows = vi.fn(() => true);
const isEmpty = vi.fn((data: { total: number }) => data.total === 0);
const componentLoad = vi.fn(async () => ({ open: 2, label: "Open" }));

/** A widget drawn by a core view, with two cases and a gated empty action. */
const openOrders = defineWidget({
  id: "acme/open-orders",
  title: "Open orders",
  description: "Orders waiting to be sent",
  size: { default: { w: 4, h: 2 }, min: { w: 3, h: 2 } },
  access: "read-orders",
  shows,
  load,
  view: "figure",
  isEmpty,
  empty: {
    message: "No open orders",
    action: {
      label: "Add an order",
      link: "collections/orders/create",
      permission: "create-orders",
    },
  },
  preview: [
    { name: "Busy", data: { total: 42 } },
    { name: "Quiet", data: { total: 0 } },
  ],
});

/** A widget drawn by its own component, with one case. */
const revenue = defineWidget({
  id: "acme/revenue",
  title: "Revenue",
  description: "Takings per day",
  size: { default: { w: 6, h: 3 } },
  load: componentLoad,
  view: { component: "@acme/shop/admin#RevenueCard" },
  isEmpty: () => false,
  preview: [{ name: "Normal day", data: { open: 7, label: "Open" } }],
});

/** A widget that declares no case. */
const noCases = defineWidget({
  id: "acme/no-cases",
  title: "No cases",
  description: "Declares no preview",
  size: { default: { w: 4, h: 2 } },
  load: async () => ({ items: [] }),
  view: "list",
});

/** An audience admitting every widget given, holding exactly `held`. */
function audienceOf(ids: readonly string[], held: readonly string[]) {
  const visible = allWidgets().filter(widget => ids.includes(widget.id));
  const audience: WidgetAudience = {
    visible,
    declared: new Set(visible.map(widget => widget.id)),
    holds: gate => gate === undefined || held.includes(String(gate)),
    heldActionGates: new Set(held),
    token: "test",
    readableCollections: new Set(),
  };
  return audience;
}

const IDS = ["acme/open-orders", "acme/revenue", "acme/no-cases"];

beforeEach(() => {
  clearWidgets();
  clearDeclaredWidgets();
  load.mockClear();
  shows.mockClear();
  isEmpty.mockClear();
  componentLoad.mockClear();
  registerDashboardWidgets({
    groups: [
      {
        owner: 'plugin "@acme/shop"',
        declarations: [openOrders, revenue, noCases],
      },
    ],
  });
});

afterEach(() => {
  clearDeclaredWidgets();
  clearWidgets();
});

describe("the widget preview read", () => {
  it("lists every widget of the audience, with its cases, running none of its server code", () => {
    const items = widgetPreviewItems(audienceOf(IDS, ["create-orders"]));

    expect(items.map(item => item.id)).toEqual(IDS);
    const figure = items[0];
    expect(figure).toMatchObject({
      title: "Open orders",
      owner: 'plugin "@acme/shop"',
      size: {
        default: { w: 4, h: 2 },
        min: { w: 3, h: 2 },
        max: { w: 12, h: 2 },
      },
      view: "figure",
    });
    // Each case as its card's slot would carry a real answer: a figure's data
    // under the op the figure display draws.
    expect(figure?.preview).toEqual([
      { name: "Busy", data: { total: 42 }, result: { total: 42, op: "count" } },
      { name: "Quiet", data: { total: 0 }, result: { total: 0, op: "count" } },
    ]);
    // A component's case as `data`, the shape its own component is handed.
    expect(items[1]?.view).toEqual({
      component: "@acme/shop/admin#RevenueCard",
    });
    expect(items[1]?.preview[0]?.result).toEqual({
      op: "data",
      data: { open: 7, label: "Open" },
    });
    // No case is said as none, never left out.
    expect(items[2]?.preview).toEqual([]);

    // 🔴 The separating property: a read that answered the ready state by
    // running the widget would list the same ids and the same titles.
    expect(load).not.toHaveBeenCalled();
    expect(componentLoad).not.toHaveBeenCalled();
    expect(shows).not.toHaveBeenCalled();
    expect(isEmpty).not.toHaveBeenCalled();
  });

  it("keeps the cases on the server: the published registry entry carries none", () => {
    // The control: the read does find them, so their absence below is the
    // registry's, not a fixture that declares no case.
    expect(widgetPreviewItems(audienceOf(IDS, []))[0]?.preview).toHaveLength(2);
    const published = getWidget("acme/open-orders");
    expect(published).toBeDefined();
    expect(published).not.toHaveProperty("preview");
    expect(JSON.stringify(published)).not.toContain("Busy");
  });

  it("offers the empty state's action only to a reader holding its permission", () => {
    const [withGrant] = widgetPreviewItems(audienceOf(IDS, ["create-orders"]));
    const [without] = widgetPreviewItems(audienceOf(IDS, []));
    expect(withGrant?.empty).toEqual({
      message: "No open orders",
      action: { label: "Add an order" },
    });
    expect(without?.empty).toEqual({ message: "No open orders" });
  });

  it("lists only the audience's widgets", () => {
    const items = widgetPreviewItems(audienceOf(["acme/revenue"], []));
    expect(items.map(item => item.id)).toEqual(["acme/revenue"]);
  });
});
