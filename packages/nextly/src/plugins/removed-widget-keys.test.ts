/**
 * Startup refuses a plugin that adds widgets or widget data sources through
 * `contributes.admin.widgets` or `contributes.widgetSources`, naming the
 * plugin, the key and the replacement. The plugins are built as plain
 * JavaScript hands them over: neither key is a field of the contributions
 * type.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import { definePlugin, type PluginDefinition } from "./plugin-context";
import { assertNoRemovedWidgetKeys } from "./removed-widget-keys";
import { resolvePlugins } from "./resolve";

const withWidget = (widget: unknown): PluginDefinition =>
  ({
    name: "@acme/p",
    version: "1.0.0",
    nextly: "*",
    contributes: { admin: { widgets: [widget] } },
  }) as unknown as PluginDefinition;

/** A widget whose `query.where` carries a bigint, which JSON cannot encode. */
const bigintWidget = {
  id: "acme/revenue",
  component: "@acme/p/admin#Revenue",
  query: { source: "collection:posts", op: "count", where: { id: 1n } },
};

/** A plugin carrying `value` under `contributes.widgetSources`, as plain JavaScript can. */
const withSources = (value: unknown, enabled?: boolean): PluginDefinition =>
  ({
    name: "@acme/s",
    version: "1.0.0",
    nextly: "*",
    ...(enabled === undefined ? {} : { enabled }),
    contributes: { widgetSources: value },
  }) as unknown as PluginDefinition;

/** A well-formed `plugin:` source, so a refusal is the key's and not a source rule's. */
const revenueSource = {
  source: {
    id: "plugin:acme/revenue",
    label: "Revenue",
    kind: "plugin",
    supports: ["count"],
    fields: [{ name: "total", type: "number" }],
  },
  resolve: () => Promise.resolve({ op: "count", total: 1 }),
};

/** A plugin declaring its widgets the one way there is, with an admin page beside them. */
const declaring = definePlugin({
  name: "@acme/d",
  version: "1.0.0",
  nextly: "*",
  contributes: {
    admin: { pages: [{ path: "reports", component: "@acme/d/admin#Reports" }] },
    dashboard: { widgets: [] },
  },
});

/** The startup failure, or `undefined` when the gate let every plugin through. */
function startupRefusal(
  plugins: readonly PluginDefinition[]
): NextlyError | undefined {
  try {
    assertNoRemovedWidgetKeys(plugins);
    return undefined;
  } catch (error) {
    expect(NextlyError.is(error)).toBe(true);
    return error as NextlyError;
  }
}

describe("startup refuses the keys a plugin no longer adds widgets through", () => {
  it("refuses contributes.admin.widgets in one sentence naming the plugin, the key and the replacement", () => {
    const refused = startupRefusal([
      withWidget({ id: "acme/posts", component: "@acme/p/admin#Posts" }),
    ]);
    expect(refused?.code).toBe("NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL");
    expect(refused?.logContext).toEqual({
      plugin: "@acme/p",
      key: "contributes.admin.widgets",
    });
    expect(refused?.logMessage).toBe(
      'Plugin "@acme/p" declares contributes.admin.widgets, which Nextly no ' +
        "longer reads: declare each widget with defineWidget() under " +
        "contributes.dashboard.widgets, and read its data in that widget's load."
    );
  });

  it("refuses contributes.widgetSources in one sentence naming the plugin, the key and the replacement", () => {
    const refused = startupRefusal([withSources([revenueSource])]);
    expect(refused?.code).toBe("NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL");
    expect(refused?.logContext).toEqual({
      plugin: "@acme/s",
      key: "contributes.widgetSources",
    });
    expect(refused?.logMessage).toBe(
      'Plugin "@acme/s" declares contributes.widgetSources, which Nextly no ' +
        "longer reads: declare each widget with defineWidget() under " +
        "contributes.dashboard.widgets, and read its data in that widget's load."
    );
  });

  it("refuses either key whatever it holds, an empty list included", () => {
    const emptyWidgets = {
      name: "@acme/p",
      version: "1.0.0",
      nextly: "*",
      contributes: { admin: { widgets: [] } },
    } as unknown as PluginDefinition;
    expect(startupRefusal([emptyWidgets])?.logContext).toEqual({
      plugin: "@acme/p",
      key: "contributes.admin.widgets",
    });
    expect(startupRefusal([withSources([])])?.logContext).toEqual({
      plugin: "@acme/s",
      key: "contributes.widgetSources",
    });
  });

  it("refuses contributes.widgetSources declared as undefined: declaring the key is the fault", () => {
    const sources = startupRefusal([
      {
        name: "@acme/s",
        version: "1.0.0",
        nextly: "*",
        contributes: { widgetSources: undefined },
      } as unknown as PluginDefinition,
    ]);
    expect(sources?.code).toBe("NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL");
    expect(sources?.logContext).toEqual({
      plugin: "@acme/s",
      key: "contributes.widgetSources",
    });
  });

  it("refuses contributes.admin.widgets declared as undefined, for the same reason", () => {
    const widgets = startupRefusal([
      {
        name: "@acme/p",
        version: "1.0.0",
        nextly: "*",
        contributes: { admin: { widgets: undefined } },
      } as unknown as PluginDefinition,
    ]);
    expect(widgets?.code).toBe("NEXTLY_PLUGIN_REMOVED_WIDGET_CHANNEL");
    expect(widgets?.logContext).toEqual({
      plugin: "@acme/p",
      key: "contributes.admin.widgets",
    });
  });

  it("lets through a plugin that leaves both keys out, whatever else it declares", () => {
    // The control for the case above: absence is not a declaration, with no
    // contributions, with no admin contributions, and with an empty admin.
    const absent = [
      { name: "@acme/a", version: "1.0.0", nextly: "*" },
      { name: "@acme/b", version: "1.0.0", nextly: "*", contributes: {} },
      {
        name: "@acme/c",
        version: "1.0.0",
        nextly: "*",
        contributes: { admin: {} },
      },
      {
        name: "@acme/d",
        version: "1.0.0",
        nextly: "*",
        contributes: { admin: undefined },
      },
    ] as unknown as PluginDefinition[];
    expect(startupRefusal(absent)).toBeUndefined();
  });

  it("refuses a disabled plugin carrying either key, so enabling it is never what fails a start", () => {
    const disabled = {
      ...withWidget(bigintWidget),
      enabled: false,
    } as PluginDefinition;
    expect(startupRefusal([disabled])?.logContext).toEqual({
      plugin: "@acme/p",
      key: "contributes.admin.widgets",
    });
    expect(startupRefusal([withSources([revenueSource], false)])).toBeDefined();
  });

  it("refuses during plugin resolution, which every boot path runs", () => {
    let thrown: unknown;
    try {
      resolvePlugins([declaring, withSources([revenueSource])], {
        coreVersion: "1.0.0",
      });
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).logContext).toEqual({
      plugin: "@acme/s",
      key: "contributes.widgetSources",
    });
  });

  it("lets through a plugin that declares its widgets under contributes.dashboard", () => {
    // The control: a gate that refused every plugin would satisfy each case above.
    expect(startupRefusal([declaring])).toBeUndefined();
    expect(() =>
      resolvePlugins([declaring], { coreVersion: "1.0.0" })
    ).not.toThrow();
  });
});
