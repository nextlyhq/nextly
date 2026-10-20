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
import { getWidget } from "../../registry";
import {
  cardQueryFor,
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
  it("keeps each enabled plugin's declared widgets, and offers none to the admin yet", () => {
    resetWidgetRegistries([plugin("@acme/shop", { dashboard })]);
    expect(declaredWidget("acme/revenue")?.owner).toBe('plugin "@acme/shop"');
    expect(declaredWidget("acme/orders-by-state")).toBeDefined();
    // Nothing runs a declared widget's data for a card yet, so the registry
    // the admin reads holds none of them, and core's own cards as before.
    expect(getWidget("acme/orders-by-state")).toBeUndefined();
    expect(getWidget("core/recently-edited")).toBeDefined();
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
            { ...revenue, id: "acme/other", width: "quarter" },
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
      'plugin "@acme/shop", widget "acme/other": width "quarter" is not one of the widths it allows'
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
