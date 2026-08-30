/**
 * A contributed widget is serialized into `/api/admin-meta/workspace`, so a
 * value that `JSON.stringify` cannot carry does not break the widget -- it
 * breaks the whole authenticated workspace response, for every admin.
 */
import { describe, expect, it } from "vitest";

import { NextlyError } from "../errors/nextly-error";

import { buildPluginAdminMeta } from "./admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";
import { assertAdminWidgets } from "./validate-admin-widgets";

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

describe("contributed widgets are validated at boot", () => {
  it("fails plugin resolution rather than the first workspace request", () => {
    expect(() =>
      resolvePlugins([withWidget(bigintWidget)], {
        coreVersion: "0.0.2-alpha.51",
      })
    ).toThrow(NextlyError);
  });

  it("names the plugin and the widget in the boot failure", () => {
    let thrown: unknown;
    try {
      assertAdminWidgets([withWidget(bigintWidget)]);
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).logMessage).toContain("@acme/p");
    expect((thrown as NextlyError).logMessage).toContain("acme/revenue");
  });

  it("refuses a Date, which JSON silently turns into a string", () => {
    // Not a throw from `JSON.stringify` -- a SILENT shape change. The admin
    // reads a string where the plugin wrote a Date, which is the failure the
    // round trip catches and a try/catch around the serializer cannot.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/since",
          component: "@acme/p/admin#Since",
          query: {
            source: "collection:posts",
            op: "count",
            where: { createdAt: { greater_than: new Date() } },
          },
        }),
      ])
    ).toThrow(NextlyError);
  });

  it("checks a DISABLED plugin's widgets too", () => {
    // `buildPluginAdminMeta` withholds a disabled plugin's widgets, so this is
    // belt-and-braces today -- but enabling the plugin must not be what turns a
    // healthy install into a 500, and boot is where that is still cheap to say.
    expect(() =>
      assertAdminWidgets([
        { ...withWidget(bigintWidget), enabled: false } as PluginDefinition,
      ])
    ).toThrow(NextlyError);
  });

  it("lets an ordinary widget through", () => {
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/revenue",
          component: "@acme/p/admin#Revenue",
          size: "half",
          query: {
            source: "collection:posts",
            op: "count",
            where: { status: { equals: "published" } },
          },
        }),
      ])
    ).not.toThrow();
  });

  it("refuses a widget whose component is an empty string", () => {
    // `component` is required by the TYPE, which reaches a TypeScript caller
    // and nothing else. A plugin authored in JavaScript, or one whose manifest
    // arrives as parsed JSON, passes the JSON round trip with `component: ""`
    // and is then CAST to `PluginAdminWidget` and published -- and
    // `PluginWidgetGrid` hands that empty path straight to `PluginSlot`, which
    // draws the blank dashboard cell making `component` required was supposed
    // to prevent.
    expect(() =>
      assertAdminWidgets([withWidget({ id: "stats", component: "" })])
    ).toThrow(NextlyError);
  });

  it("refuses a widget whose component is only whitespace", () => {
    // A path made of spaces resolves no better than an empty one, which is the
    // same reading `validateWidgetDefinition` takes of a `custom` widget's
    // component.
    expect(() =>
      assertAdminWidgets([withWidget({ id: "stats", component: "   " })])
    ).toThrow(NextlyError);
  });

  it("refuses a widget carrying no component at all", () => {
    expect(() => assertAdminWidgets([withWidget({ id: "stats" })])).toThrow(
      NextlyError
    );
  });

  it("refuses a widget carrying no usable id", () => {
    // The grid keys each cell on `id`, so a blank one collides with every
    // other blank one and React reconciles two different widgets as one.
    expect(() =>
      assertAdminWidgets([
        withWidget({ id: "  ", component: "@acme/p/admin#Stats" }),
      ])
    ).toThrow(NextlyError);
    expect(() =>
      assertAdminWidgets([withWidget({ component: "@acme/p/admin#Stats" })])
    ).toThrow(NextlyError);
  });

  it("refuses a component that is not a string", () => {
    // JSON carries a number happily, so the round trip has nothing to say
    // about it.
    expect(() =>
      assertAdminWidgets([withWidget({ id: "stats", component: 7 })])
    ).toThrow(NextlyError);
  });

  it("names the plugin and the widget in the shape failure too", () => {
    // The same diagnostic the JSON refusal gives, so an author reading a boot
    // failure can find the entry whichever way it was malformed.
    let thrown: unknown;
    try {
      assertAdminWidgets([withWidget({ id: "stats", component: "" })]);
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).logMessage).toContain("@acme/p");
    expect((thrown as NextlyError).logMessage).toContain("stats");
  });

  it("accepts an id that is not in `namespace/name` form", () => {
    // The control that keeps the check from being widened into
    // `validateWidgetDefinition`'s. `PluginAdminWidget` puts no shape on `id`
    // -- a bare `stats` is a legal contribution, and rejecting it would refuse
    // valid plugins in the name of fixing this.
    expect(() =>
      assertAdminWidgets([
        withWidget({ id: "stats", component: "@acme/p/admin#Stats" }),
      ])
    ).not.toThrow();
  });

  it("accepts a widget declaring no title, archetype or defaultSize", () => {
    // The other half of that control. Those three are REQUIRED on a
    // `WidgetDefinition` and OPTIONAL on a `PluginAdminWidget`, so borrowing
    // the definition validator here would reject the shape this file exists to
    // check.
    expect(() =>
      assertAdminWidgets([
        withWidget({ id: "stats", component: "@acme/p/admin#Stats" }),
      ])
    ).not.toThrow();
  });

  it("accepts a plugin contributing no widgets at all", () => {
    expect(() =>
      assertAdminWidgets([
        { name: "@acme/q", version: "1.0.0" } as unknown as PluginDefinition,
      ])
    ).not.toThrow();
  });
});

describe("the serializer cannot publish what boot refused", () => {
  it("refuses before the payload reaches JSON.stringify", () => {
    // The defect this closes: `buildPluginAdminMeta` copied the widget verbatim
    // and the throw landed in `respondData`'s `JSON.stringify`, where
    // `withErrorHandler` reads it as internal -- so every admin's
    // `/api/admin-meta/workspace` answered 500, not just the broken card.
    expect(() =>
      buildPluginAdminMeta([withWidget(bigintWidget)], undefined)
    ).toThrow(NextlyError);
  });

  it("leaves a well-formed widget serializable", () => {
    const meta = buildPluginAdminMeta(
      [
        withWidget({
          id: "acme/revenue",
          component: "@acme/p/admin#Revenue",
          size: "half",
        }),
      ],
      undefined
    );
    expect(meta[0].widgets).toHaveLength(1);
    expect(() => JSON.stringify(meta)).not.toThrow();
  });
});
