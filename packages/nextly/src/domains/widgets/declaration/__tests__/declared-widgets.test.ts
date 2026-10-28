/**
 * The declared widgets core knows at startup: checked all together, kept for
 * the server, offered to the admin as data only (not yet those drawn by their
 * own component), and looked up by id when a card's query is built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { CORE_WIDGETS } from "../../core-widgets";
import type { WidgetDefinition } from "../../definition";
import { clearWidgets, getWidget } from "../../registry";
import {
  clearDeclaredWidgets,
  declaredWidget,
  registerDashboardWidgets,
  resetLegacyIdWarnings,
} from "../declared-widgets";
import { defineWidget } from "../define-widget";
import { ordersByState, recentOrders, revenue } from "./plugin/widgets";

const SHOP = 'plugin "@acme/shop"';

let warn: ReturnType<typeof vi.fn>;

beforeEach(() => {
  clearWidgets();
  clearDeclaredWidgets();
  resetLegacyIdWarnings();
  warn = vi.fn();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the one call every owner's widgets come through", () => {
  /** The startup error's detail, or a failure when startup did not stop. */
  function refused(run: () => void): string {
    try {
      run();
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      return (error as NextlyError).logMessage ?? "";
    }
    throw new Error("expected startup to stop");
  }

  it("names every fault of every owner, core's own included, in one message, and keeps none", () => {
    // 🔴 Core's list was registered on its own before the declarations, so a
    // mistake in it threw alone, and a plugin's fault was a second boot away,
    // with core's cards already kept. Now both arrive in one message.
    const [first, second] = CORE_WIDGETS;
    const message = refused(() =>
      registerDashboardWidgets({
        core: [
          first,
          first,
          {
            ...second,
            size: { default: { w: 13, h: 3 } },
          } as WidgetDefinition,
        ],
        groups: [{ owner: SHOP, declarations: [{ ...revenue, title: "" }] }],
      })
    );
    expect(message).toContain(
      `core, widget "${first.id}": id "${first.id}" is already declared by core`
    );
    expect(message).toMatch(new RegExp(`core, widget "${second.id}": .*size`));
    expect(message).toContain(
      `${SHOP}, widget "${revenue.id}": title must be a non-empty string`
    );
    // Nothing kept: neither core's widgets nor the plugin's.
    expect(getWidget(first.id)).toBeUndefined();
    expect(getWidget(revenue.id)).toBeUndefined();
  });
});

describe("registering declared widgets", () => {
  it("publishes each to the registry the admin reads as data only, its cards answered on the server", () => {
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [ordersByState, recentOrders] }],
    });
    const published = getWidget("acme/orders-by-state");
    expect(published).toMatchObject({
      id: "acme/orders-by-state",
      title: "Orders by state",
      description: "How many orders sit in each state",
      category: "Shop",
      archetype: "bars",
      requiredPermission: "read-orders",
      size: {
        default: { w: 6, h: 4 },
        min: { w: 4, h: 3 },
        max: { w: 8, h: 6 },
      },
      serverData: true,
    });
    // Data only: no query, no data function and no empty test reach what the admin is sent,
    // and what is published survives JSON exactly, so nothing in it is code.
    expect(published?.query).toBeUndefined();
    expect(JSON.parse(JSON.stringify(published))).toEqual(published);
    expect(Object.keys(published ?? {})).not.toContain("data");
    expect(Object.keys(published ?? {})).not.toContain("load");
    // Each widget's own size, in grid units, as it declares it.
    expect(getWidget("acme/recent-orders")?.size).toEqual({
      default: { w: 12, h: 5 },
      min: { w: 6, h: 4 },
      max: { w: 12, h: 8 },
    });
    // A declared empty state: its words and action are published, its test is not, and the
    // action's permission is the gate's own name.
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [
            { ...ordersByState, id: "acme/orders-empty", empty: revenue.empty },
          ],
        },
      ],
    });
    const own = getWidget("acme/orders-empty");
    expect(own).toMatchObject({
      archetype: "bars",
      empty: {
        message: "No takings in this range",
        action: {
          label: "Add a product",
          link: "collections/products/create",
          requiredPermission: "create-products",
        },
      },
    });
    expect(Object.keys(own?.empty ?? {})).not.toContain("when");
    // And the declaration itself is still kept whole, for the server to answer its cards from.
    expect(declaredWidget("acme/orders-by-state")).toMatchObject({
      owner: SHOP,
      declaration: ordersByState,
    });
  });

  it("publishes a link action whose JavaScript declaration also carries opens: undefined, as a link", () => {
    // Read by the key, `opens` with no value was published as a settings action without one, which
    // the registry refuses at startup; the startup check reads it as the link it is.
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [
            {
              ...ordersByState,
              id: "acme/orders-linked",
              empty: {
                message: "No orders yet",
                action: {
                  label: "Add an order",
                  link: "collections/orders/create",
                  opens: undefined,
                },
              },
            } as unknown as typeof ordersByState,
          ],
        },
      ],
    });
    expect(getWidget("acme/orders-linked")?.empty?.action).toEqual({
      label: "Add an order",
      link: "collections/orders/create",
    });
  });

  it("publishes an empty action that opens the card's settings as it is, with no gate", () => {
    // Accepted by the registry's own check too: the registration would refuse an action it read
    // as having no link.
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [
            {
              ...ordersByState,
              id: "acme/orders-choose",
              empty: {
                message: "Pick a collection",
                action: { label: "Choose", opens: "settings" },
              },
            },
          ],
        },
      ],
    });
    expect(getWidget("acme/orders-choose")?.empty).toEqual({
      message: "Pick a collection",
      action: { label: "Choose", opens: "settings" },
    });
  });

  it("publishes a widget drawn by its own component as a custom card core answers", () => {
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [revenue] }],
    });
    // The admin hands its component the props its declaration types, so it is
    // offered like any declared widget: drawn by that component, its data
    // built on the server.
    expect(getWidget("acme/revenue")).toMatchObject({
      archetype: "custom",
      component: revenue.view.component,
      serverData: true,
      // Who declared it, so a card whose component is missing can say whose it is.
      owner: SHOP,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("publishes a core view by the display that draws it, under Other when it names no category", () => {
    // Its bars-shaped preview goes too: a figure draws a total, not groups.
    const {
      category: _category,
      preview: _preview,
      ...uncategorised
    } = ordersByState;
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [
            { ...uncategorised, id: "acme/figure", view: "figure" as const },
            ordersByState,
          ],
        },
      ],
    });
    // `figure` is drawn by the metric display; the add panel sketches it by that archetype.
    expect(getWidget("acme/figure")).toMatchObject({
      archetype: "metric",
      category: "Other",
    });
    // Core draws it, so there is no component, and no owner of one to name.
    expect(getWidget("acme/figure")?.owner).toBeUndefined();
    // The control: a category the declaration names is kept as written.
    expect(getWidget(ordersByState.id)).toMatchObject({
      archetype: "bars",
      category: "Shop",
    });
  });

  it("publishes hidesWhenEmpty only for a widget that declares it", () => {
    registerDashboardWidgets({
      groups: [
        {
          owner: SHOP,
          declarations: [{ ...revenue, hidesWhenEmpty: true }, ordersByState],
        },
      ],
    });
    expect(getWidget("acme/revenue")?.hidesWhenEmpty).toBe(true);
    // The control: a widget that says nothing is not published as hiding.
    expect(getWidget(ordersByState.id)?.hidesWhenEmpty).toBeUndefined();
  });

  it("keeps each declaration, with its server code, for the server's own use", () => {
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [recentOrders] }],
    });
    expect(declaredWidget("acme/recent-orders")).toMatchObject({
      owner: SHOP,
      declaration: recentOrders,
      display: "list",
    });
    // Its load function is kept as the plugin wrote it, to be run per card.
    expect(declaredWidget("acme/recent-orders")?.declaration.load).toBe(
      recentOrders.load
    );
    expect(declaredWidget("acme/unknown")).toBeUndefined();
  });

  it("publishes a size stated by its default alone with every end filled in", () => {
    // 🔴 Filled in once, here, by the grid's own rule: the smallest size is
    // the default, the largest the full width at the default's height. A
    // reader of the registry then has no missing end to fill its own way.
    const small = defineWidget({
      id: "acme/small",
      title: "Small",
      description: "Starts small and may grow only wider",
      category: "Test",
      size: { default: { w: 3, h: 2 } },
      load: async () => ({ total: 3 }),
      view: "figure",
    });
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [small] }],
    });
    const published = getWidget("acme/small")?.size;
    expect(published).toEqual({
      default: { w: 3, h: 2 },
      min: { w: 3, h: 2 },
      max: { w: 12, h: 2 },
    });
    // A copy: what is published shares no object with the declaration kept
    // for the server.
    expect(published?.default).not.toBe(small.size.default);
    expect(declaredWidget("acme/small")?.declaration.size).toEqual({
      default: { w: 3, h: 2 },
    });
  });

  it("registers nothing when any declaration cannot work, and names every fault", () => {
    let thrown: unknown;
    try {
      registerDashboardWidgets({
        groups: [
          {
            owner: SHOP,
            declarations: [ordersByState, { ...revenue, title: "" }],
          },
        ],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    expect((thrown as NextlyError).logMessage).toContain(
      `${SHOP}, widget "acme/revenue": title must be a non-empty string`
    );
    // All or nothing: the valid declaration beside the faulty one is not left
    // half-registered for a boot that is about to stop.
    expect(declaredWidget("acme/orders-by-state")).toBeUndefined();
  });
});

describe("declarations plain JavaScript can hand over", () => {
  it("reports an entry that is not an object with the other faults, beside old-shape ids", () => {
    let thrown: unknown;
    try {
      registerDashboardWidgets({
        groups: [
          { owner: SHOP, declarations: [null, { ...revenue, title: "" }] },
        ],
        legacy: [{ owner: 'plugin "@old/stats"', ids: ["old/x"] }],
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(NextlyError);
    const message = (thrown as NextlyError).logMessage ?? "";
    expect(message).toContain("2 widget declarations cannot work");
    expect(message).toContain("title must be a non-empty string");
  });

  it("keeps the values startup checked, whatever a getter answers later", () => {
    // An accessor answering one id when checked and another when kept would
    // get past the reserved namespaces and the duplicate check.
    let reads = 0;
    const shifting = { ...recentOrders };
    Object.defineProperty(shifting, "id", {
      enumerable: true,
      get: () => (reads++ === 0 ? "acme/recent-orders" : "core/recent-orders"),
    });
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [shifting] }],
    });
    expect(declaredWidget("acme/recent-orders")?.declaration.id).toBe(
      "acme/recent-orders"
    );
    expect(declaredWidget("core/recent-orders")).toBeUndefined();
  });
});

describe("widgets in today's shape", () => {
  it("stop startup when a declared widget takes an id one of them uses", () => {
    expect(() =>
      registerDashboardWidgets({
        groups: [{ owner: SHOP, declarations: [ordersByState] }],
        legacy: [
          { owner: 'plugin "@old/stats"', ids: ["acme/orders-by-state"] },
        ],
      })
    ).toThrow(NextlyError);
    try {
      registerDashboardWidgets({
        groups: [{ owner: SHOP, declarations: [ordersByState] }],
        legacy: [
          { owner: 'plugin "@old/stats"', ids: ["acme/orders-by-state"] },
        ],
      });
    } catch (error) {
      expect((error as NextlyError).logMessage).toContain(
        'id "acme/orders-by-state" is already used by plugin "@old/stats", which declares it in the old shape'
      );
    }
  });

  it("keep today's rule between themselves, the first winning, with one warning per id", () => {
    const legacy = [
      { owner: 'plugin "@one/a"', ids: ["shared/card"] },
      { owner: 'plugin "@two/b"', ids: ["shared/card"] },
    ];
    expect(() =>
      registerDashboardWidgets({ groups: [], legacy: legacy })
    ).not.toThrow();
    registerDashboardWidgets({ groups: [], legacy: legacy });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      kind: "widget-id-shared-old-shape",
      widget: "shared/card",
      plugins: ['plugin "@one/a"', 'plugin "@two/b"'],
    });
  });

  it("may use a namespace the new shape reserves", () => {
    expect(() =>
      registerDashboardWidgets({
        groups: [],
        legacy: [{ owner: SHOP, ids: ["core/acme-card"] }],
      })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("clearing", () => {
  it("forgets every declared widget, so a reload starts from nothing", () => {
    registerDashboardWidgets({
      groups: [{ owner: SHOP, declarations: [ordersByState] }],
    });
    clearDeclaredWidgets();
    expect(declaredWidget("acme/orders-by-state")).toBeUndefined();
  });
});
