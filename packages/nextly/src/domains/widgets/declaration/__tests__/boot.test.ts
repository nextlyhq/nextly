/**
 * Startup reads every enabled plugin's `contributes.dashboard.widgets` into
 * the one store of declared widgets, through the same reset that registers
 * core's own cards, and stops on any fault, all of them reported at once.
 *
 * Driven through `resetWidgetRegistries`, the function both boot paths call,
 * with plugins built by `definePlugin` as an author's would be.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../../di/registrations/register-widgets";
import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import { definePlugin } from "../../../../plugins/plugin-context";
import type { PluginContributions } from "../../../../plugins/contributions";
import { getWidget, widgetSource } from "../../registry";
import {
  cardQueryFor,
  clearDeclaredWidgets,
  declaredWidget,
  resetLegacyIdWarnings,
} from "../declared-widgets";
import { dashboard, revenue } from "./plugin/widgets";

function plugin(
  name: string,
  contributes: PluginContributions,
  enabled?: boolean
) {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: "*",
    contributes,
    ...(enabled === undefined ? {} : { enabled }),
  });
}

/**
 * A dashboard as a plain JavaScript plugin hands it over: unchecked by types,
 * which would refuse the faulty declarations these cases are about.
 */
const untyped = (widgets: unknown): PluginContributions["dashboard"] =>
  ({ widgets }) as unknown as PluginContributions["dashboard"];

/** The startup error's detail, or a failure when startup did not stop. */
function refusal(run: () => void): string {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(NextlyError);
    return (error as NextlyError).logMessage ?? "";
  }
  throw new Error("expected startup to stop");
}

beforeEach(() => {
  resetLegacyIdWarnings();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

describe("startup with plugins that declare widgets", () => {
  it("keeps each enabled plugin's declared widgets, and offers them to the admin as answered on the server", () => {
    resetWidgetRegistries([plugin("@acme/shop", { dashboard })]);
    expect(declaredWidget("acme/revenue")?.owner).toBe('plugin "@acme/shop"');
    expect(declaredWidget("acme/orders-by-state")).toBeDefined();
    // Published as they are kept: the admin is offered each one, with its data built on the
    // server from the declaration only core holds, so the definition carries neither.
    const published = getWidget("acme/orders-by-state");
    expect(published).toMatchObject({
      id: "acme/orders-by-state",
      serverData: true,
    });
    expect(published).not.toHaveProperty("query");
    expect(published).not.toHaveProperty("data");
    expect(widgetSource("acme/orders-by-state")).toBe('plugin "@acme/shop"');
    expect(getWidget("core/recently-edited")).toBeDefined();
  });

  it("withdraws what a declaration published when the declarations are cleared, and nothing else", () => {
    resetWidgetRegistries([plugin("@acme/shop", { dashboard })]);
    expect(getWidget("acme/orders-by-state")).toBeDefined();
    clearDeclaredWidgets();
    expect(getWidget("acme/orders-by-state")).toBeUndefined();
    // Core's own cards were never a declaration's, so they stay.
    expect(getWidget("core/recently-edited")).toBeDefined();
    // And the same declarations can be made again.
    expect(() =>
      resetWidgetRegistries([plugin("@acme/shop", { dashboard })])
    ).not.toThrow();
  });

  it("builds a card's query under the slug a site renamed the plugin's collection to", () => {
    const shop = definePlugin({
      name: "@acme/shop",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        collections: [{ slug: "orders", fields: [] }],
        dashboard,
      },
    });
    resetWidgetRegistries([shop.rename!({ orders: "sales" })]);
    expect(
      cardQueryFor("acme/recent-orders", { collection: "orders" })
    ).toMatchObject({ source: "collection:sales" });
  });

  it("registers nothing from a disabled plugin", () => {
    resetWidgetRegistries([plugin("@acme/shop", { dashboard }, false)]);
    expect(getWidget("acme/orders-by-state")).toBeUndefined();
    expect(declaredWidget("acme/orders-by-state")).toBeUndefined();
  });

  it("can run again, as a development reload does, without colliding with itself", () => {
    const plugins = [plugin("@acme/shop", { dashboard })];
    resetWidgetRegistries(plugins);
    expect(() => resetWidgetRegistries(plugins)).not.toThrow();
  });

  it("stops on three faults in two plugins, naming every one in one message", () => {
    const message = refusal(() =>
      resetWidgetRegistries([
        plugin("@acme/shop", {
          dashboard: untyped([
            { ...revenue, title: "" },
            {
              ...revenue,
              id: "acme/other",
              // Narrower than the size it starts at.
              size: { ...revenue.size, max: { w: 7, h: 4 } },
            },
          ]),
        }),
        plugin("@other/stats", {
          dashboard: untyped([{ ...revenue, id: "other/x", category: 3 }]),
        }),
      ])
    );
    expect(message).toContain("3 widget declarations cannot work");
    expect(message).toContain(
      'plugin "@acme/shop", widget "acme/revenue": title must be a non-empty string'
    );
    expect(message).toContain(
      'plugin "@acme/shop", widget "acme/other": size.default must not be larger than size.max'
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "other/x": category must be a non-empty string'
    );
  });

  it("stops on a dashboard whose widgets are not a list", () => {
    const message = refusal(() =>
      resetWidgetRegistries([
        plugin("@acme/shop", {
          dashboard: untyped(revenue),
        }),
      ])
    );
    expect(message).toContain(
      'plugin "@acme/shop", widget "(none)": its dashboard widgets must be a list'
    );
  });

  it("stops when a declared widget takes an id another plugin uses in today's shape", () => {
    const message = refusal(() =>
      resetWidgetRegistries([
        plugin("@old/stats", {
          admin: {
            widgets: [
              {
                id: "acme/revenue",
                title: "Revenue",
                component: "@old/stats/admin#Revenue",
              },
            ],
          },
        }),
        plugin("@acme/shop", { dashboard: { widgets: [revenue] } }),
      ])
    );
    expect(message).toContain(
      'id "acme/revenue" is already used by plugin "@old/stats", which declares it in the old shape'
    );
  });
});
