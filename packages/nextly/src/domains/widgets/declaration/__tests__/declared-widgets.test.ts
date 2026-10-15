/**
 * The declared widgets core knows at startup: checked all together, published
 * to the registry the admin reads, and looked up by id when a card's query is
 * built.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { clearWidgets, getWidget, widgetSource } from "../../registry";
import {
  cardQueryFor,
  clearDeclaredWidgets,
  declaredWidget,
  registerWidgetDeclarations,
  resetLegacyIdWarnings,
} from "../declared-widgets";
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
  it("publishes a core-display widget as a definition the admin can read, with no server code", () => {
    registerWidgetDeclarations([
      { owner: SHOP, declarations: [ordersByState] },
    ]);

    const definition = getWidget("acme/orders-by-state");
    expect(definition).toMatchObject({
      id: "acme/orders-by-state",
      title: "Orders by state",
      description: "How many orders sit in each state",
      category: "Shop",
      archetype: "bars",
      serverData: true,
      requiredPermission: "read-orders",
      // Its widths, 1/3 to 2/3, starting at 1/2, as the registry's steps.
      defaultSize: "lg",
      minSize: "md",
      maxSize: "xl",
    });
    expect(widgetSource("acme/orders-by-state")).toBe(SHOP);
    // 🔴 The definition reaches the browser, so it must hold data only: it
    // survives a JSON round trip unchanged, which a function would not.
    expect(JSON.parse(JSON.stringify(definition))).toEqual(definition);
    expect(definition).not.toHaveProperty("data");
  });

  it("publishes a component widget as a custom card naming its component", () => {
    registerWidgetDeclarations([{ owner: SHOP, declarations: [revenue] }]);
    expect(getWidget("acme/revenue")).toMatchObject({
      archetype: "custom",
      component: "@acme/nextly-plugin-shop/admin#RevenueCard",
      serverData: true,
    });
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
    expect(getWidget("acme/orders-by-state")).toBeUndefined();
    expect(declaredWidget("acme/orders-by-state")).toBeUndefined();
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
