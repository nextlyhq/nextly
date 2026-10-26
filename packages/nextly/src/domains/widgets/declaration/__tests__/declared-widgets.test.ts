/**
 * The declared widgets core knows at startup: checked all together, kept for
 * the server, offered to the admin as data only (not yet those drawn by their
 * own component), and looked up by id when a card's query is built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { clearWidgets, getWidget } from "../../registry";
import { isWidgetWidth } from "../../widths";
import {
  cardQueryFor,
  clearDeclaredWidgets,
  declaredWidget,
  registerWidgetDeclarations,
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

describe("registering declared widgets", () => {
  it("publishes each to the registry the admin reads as data only, its cards answered on the server", () => {
    registerWidgetDeclarations([
      { owner: SHOP, declarations: [ordersByState, recentOrders] },
    ]);
    const published = getWidget("acme/orders-by-state");
    expect(published).toMatchObject({
      id: "acme/orders-by-state",
      title: "Orders by state",
      description: "How many orders sit in each state",
      category: "Shop",
      archetype: "bars",
      sketch: "bars",
      requiredPermission: "read-orders",
      allowedWidths: ["third", "half", "twoThirds"],
      defaultWidth: "half",
      serverData: true,
    });
    // Data only: no query, no data function and no empty test reach what the admin is sent,
    // and what is published survives JSON exactly, so nothing in it is code.
    expect(published?.query).toBeUndefined();
    expect(JSON.parse(JSON.stringify(published))).toEqual(published);
    expect(Object.keys(published ?? {})).not.toContain("data");
    // The widths as declared, a gap included: `recent-orders` takes half and full, not two thirds.
    expect(getWidget("acme/recent-orders")?.allowedWidths).toEqual([
      "half",
      "full",
    ]);
    // A declared empty state: its words and action are published, its test is not, and the
    // action's permission is the gate's own name.
    registerWidgetDeclarations([
      {
        owner: SHOP,
        declarations: [
          { ...ordersByState, id: "acme/orders-empty", empty: revenue.empty },
        ],
      },
    ]);
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

  it("publishes a widget drawn by its own component as a custom card core answers", () => {
    registerWidgetDeclarations([{ owner: SHOP, declarations: [revenue] }]);
    // The admin hands its component the props its declaration types, so it is
    // offered like any declared widget: drawn by that component, its data
    // built on the server.
    expect(getWidget("acme/revenue")).toMatchObject({
      archetype: "custom",
      component: (revenue.display as { component: string }).component,
      serverData: true,
    });
    expect(warn).not.toHaveBeenCalled();
  });

  it("keeps each declaration, with its server code, for the server's own use", () => {
    registerWidgetDeclarations([{ owner: SHOP, declarations: [recentOrders] }]);
    expect(declaredWidget("acme/recent-orders")).toMatchObject({
      owner: SHOP,
      declaration: recentOrders,
    });
    expect(
      cardQueryFor("acme/recent-orders", { collection: "orders", items: 3 })
    ).toMatchObject({ source: "collection:orders", op: "list", limit: 3 });
    expect(cardQueryFor("acme/unknown", {})).toBeUndefined();
  });

  it("refuses a card's query its display cannot draw, once the card names its collection", () => {
    // Plain JavaScript, as no type saw it: a list whose query selects nothing.
    // Its Collection setting has no default, so startup builds no query and
    // checks nothing; the first query is this card's own.
    const unselected = {
      ...recentOrders,
      id: "acme/unselected",
      data: {
        query: ({ settings }: { settings: Record<string, unknown> }) => ({
          collection: settings.collection,
          op: "list",
          limit: settings.items,
        }),
      },
    } as unknown as typeof recentOrders;
    registerWidgetDeclarations([{ owner: SHOP, declarations: [unselected] }]);

    expect(cardQueryFor("acme/unselected", {})).toBeUndefined();
    let refused: unknown;
    try {
      cardQueryFor("acme/unselected", { collection: "orders" });
    } catch (error) {
      refused = error;
    }
    expect(refused).toBeInstanceOf(NextlyError);
    expect((refused as NextlyError).logMessage).toBe(
      'Declared widget "acme/unselected" cannot draw its query: its query selects no fields, so the "list" display has nothing to show in each row.'
    );
  });

  it("keeps a declared set of widths with gaps, in core's own words", () => {
    // Two widths that are not neighbours: no smallest-to-largest range could
    // say this, and the set is read back exactly as declared, in the
    // vocabulary a stored placement and the admin use.
    const gapped = defineWidget({
      id: "acme/gapped",
      title: "Gapped",
      description: "Allowed at a quarter or at two thirds, nothing between",
      category: "Test",
      widths: ["quarter", "twoThirds"],
      width: "quarter",
      data: async () => ({ total: 3 }),
      display: "metric",
    });
    registerWidgetDeclarations([{ owner: SHOP, declarations: [gapped] }]);
    const widths = declaredWidget("acme/gapped")?.declaration.widths;
    expect(widths).toEqual(["quarter", "twoThirds"]);
    // Every one is a width the arrangement itself stores.
    expect(widths?.every(isWidgetWidth)).toBe(true);
  });

  it("registers nothing when any declaration cannot work, and names every fault", () => {
    let thrown: unknown;
    try {
      registerWidgetDeclarations([
        {
          owner: SHOP,
          declarations: [ordersByState, { ...revenue, title: "" }],
        },
      ]);
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
      registerWidgetDeclarations(
        [{ owner: SHOP, declarations: [null, { ...revenue, title: "" }] }],
        [{ owner: 'plugin "@old/stats"', ids: ["old/x"] }]
      );
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
    registerWidgetDeclarations([{ owner: SHOP, declarations: [shifting] }]);
    expect(declaredWidget("acme/recent-orders")?.declaration.id).toBe(
      "acme/recent-orders"
    );
    expect(declaredWidget("core/recent-orders")).toBeUndefined();
  });
});

describe("widgets in today's shape", () => {
  it("stop startup when a declared widget takes an id one of them uses", () => {
    expect(() =>
      registerWidgetDeclarations(
        [{ owner: SHOP, declarations: [ordersByState] }],
        [{ owner: 'plugin "@old/stats"', ids: ["acme/orders-by-state"] }]
      )
    ).toThrow(NextlyError);
    try {
      registerWidgetDeclarations(
        [{ owner: SHOP, declarations: [ordersByState] }],
        [{ owner: 'plugin "@old/stats"', ids: ["acme/orders-by-state"] }]
      );
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
    expect(() => registerWidgetDeclarations([], legacy)).not.toThrow();
    registerWidgetDeclarations([], legacy);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toMatchObject({
      kind: "widget-id-shared-old-shape",
      widget: "shared/card",
      plugins: ['plugin "@one/a"', 'plugin "@two/b"'],
    });
  });

  it("may use a namespace the new shape reserves", () => {
    expect(() =>
      registerWidgetDeclarations([], [{ owner: SHOP, ids: ["core/acme-card"] }])
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("clearing", () => {
  it("forgets every declared widget, so a reload starts from nothing", () => {
    registerWidgetDeclarations([
      { owner: SHOP, declarations: [ordersByState] },
    ]);
    clearDeclaredWidgets();
    expect(declaredWidget("acme/orders-by-state")).toBeUndefined();
  });
});
