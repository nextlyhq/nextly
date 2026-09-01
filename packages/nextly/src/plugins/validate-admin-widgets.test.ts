/**
 * A contributed widget is serialized into `/api/admin-meta/workspace`, so a
 * value that `JSON.stringify` cannot carry does not break the widget -- it
 * breaks the whole authenticated workspace response, for every admin.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

import { NextlyError } from "../errors/nextly-error";
import * as loggerModule from "../observability/logger";

import { buildPluginAdminMeta } from "./admin-meta";
import type { PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";
import {
  assertAdminWidgets,
  resetArchetypeWarnings,
} from "./validate-admin-widgets";

afterEach(() => {
  vi.restoreAllMocks();
  // The warning set is module-level and outlives a case, so without this the
  // second test to use a given archetype finds it already warned.
  resetArchetypeWarnings();
});

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
    // The grid hands that empty path straight to `PluginSlot`, which
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

  it("refuses a widget that describes no body at all", () => {
    // Neither a component to draw it nor an archetype-and-query for core to
    // draw it from. Both routes are closed, so nothing can render this.
    expect(() => assertAdminWidgets([withWidget({ id: "stats" })])).toThrow(
      NextlyError
    );
  });

  it("accepts a DECLARATIVE widget that ships no component", () => {
    // Tier 1, and the reason this gate changed. The host draws the card from
    // the archetype and the query; requiring a component here made the tier the
    // whole widget query contract exists for impossible to declare, and forced
    // an author to name a component core would never resolve.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/posts",
          title: "Published posts",
          archetype: "metric",
          defaultSize: "sm",
          query: { source: "collection:posts", op: "count" },
        }),
      ])
    ).not.toThrow();
  });

  it("refuses a declarative archetype that brings no query", () => {
    // The pair is the unit. Core draws every archetype but `custom` FROM A
    // QUERY RESULT, so an archetype alone describes a card core can never fill:
    // no request is made for it, no slot arrives, and the grid reads that
    // absence as still loading for the life of the page.
    expect(() =>
      assertAdminWidgets([
        withWidget({ id: "acme/posts", archetype: "metric" }),
      ])
    ).toThrow(NextlyError);
  });

  it("refuses `custom` with no component, which is the one archetype that needs one", () => {
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/panel",
          archetype: "custom",
          query: { source: "collection:posts", op: "count" },
        }),
      ])
    ).toThrow(NextlyError);
  });

  it("ACCEPTS an archetype this core does not know, and says so", () => {
    // Forward compatibility, and the reachable cause is a plugin built against
    // a newer core. `assertAdminWidgets` runs during plugin resolution, so
    // refusing here would abort the whole install over one card core cannot
    // draw -- while the grid already reports exactly that, by name, in the
    // card's own place. The blast-radius argument behind the refusals in this
    // file is about a widget that breaks the workspace payload for every
    // admin; an unrecognised archetype is perfectly serializable.
    const warn = vi.fn();
    vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);

    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/posts",
          archetype: "metrics",
          query: { source: "collection:posts", op: "count" },
        }),
      ])
    ).not.toThrow();

    // Not swallowed either: the other reachable cause is a typo, and a card
    // reading "not rendered yet" suggests waiting rather than fixing.
    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls[0][0] as Record<string, unknown>;
    expect(logged.kind).toBe("widget-archetype-unknown");
    expect(logged.archetype).toBe("metrics");
    expect(String(logged.message)).toContain("metric");
  });

  it("warns ONCE about the same widget across repeated boot passes", () => {
    // `assertAdminWidgets` runs more than once per boot: `registerServices`
    // calls it through `resolvePlugins` and then again on the transformed list,
    // and the CLI does the same. An unchanged widget was reported twice, which
    // reads as two problems and teaches the author nothing the second time.
    const warn = vi.fn();
    vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);

    const plugins = [
      withWidget({
        id: "acme/posts",
        archetype: "metrics",
        query: { source: "collection:posts", op: "count" },
      }),
    ];
    assertAdminWidgets(plugins);
    assertAdminWidgets(plugins);

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("refuses a whitespace-only component even when the declarative half is valid", () => {
    // The admin resolver reads `component` for TRUTHINESS, so a whitespace
    // string won the archetype fallback, reached `PluginSlot` as a path nothing
    // resolves, and drew a blank card where the archetype's own diagnostic
    // belonged. An absent component is a choice; an unusable one is a mistake.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/posts",
          archetype: "metric",
          query: { source: "collection:posts", op: "count" },
          component: "   ",
        }),
      ])
    ).toThrow(NextlyError);
  });

  it("still accepts a declarative widget that OMITS the component", () => {
    // The control: absent is fine, unusable is not.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/posts",
          archetype: "metric",
          query: { source: "collection:posts", op: "count" },
        }),
      ])
    ).not.toThrow();
  });

  it("refuses a contributed action missing its label or href", () => {
    // A JavaScript plugin or a decoded manifest reaches this check with nothing
    // enforced by the type. Checking only that the array was non-empty let
    // `actions: [{}]` through, and the admin drew a blank link with an
    // undefined destination -- while a REGISTERED widget carrying the same
    // shortcut was refused. One contract, two channels, one rule.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{}],
        }),
      ])
    ).toThrow(NextlyError);

    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post" }],
        }),
      ])
    ).toThrow(NextlyError);
  });

  it("accepts a contributed actions widget whose shortcuts are complete", () => {
    // The control. A gate that refused every actions widget would satisfy the
    // assertions above while making the archetype undeclarable.
    expect(() =>
      assertAdminWidgets([
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post", href: "/admin/posts/new" }],
        }),
      ])
    ).not.toThrow();
  });

  it("says nothing about an archetype it DOES know", () => {
    // The control. A warning that fired for every widget would satisfy the
    // assertion above while telling an author nothing.
    const warn = vi.fn();
    vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
      warn,
      info: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);

    assertAdminWidgets([
      withWidget({
        id: "acme/posts",
        archetype: "metric",
        query: { source: "collection:posts", op: "count" },
      }),
    ]);

    expect(warn).not.toHaveBeenCalled();
  });

  it("names BOTH routes in the diagnostic an author actually reads", () => {
    // The author has two ways out and the sentence has to say so, or the
    // obvious reading is that the old component-or-nothing rule still stands.
    //
    // Asserted on `logMessage`, which is where this factory puts the detail --
    // `publicMessage` is deliberately generic. A test reading `.message` passes
    // against any refusal at all and says nothing about what the author is
    // told, which is the entire point of failing at boot rather than dropping
    // the widget.
    let thrown: NextlyError | undefined;
    try {
      assertAdminWidgets([withWidget({ id: "stats" })]);
    } catch (error) {
      thrown = error as NextlyError;
    }

    expect(thrown).toBeInstanceOf(NextlyError);
    const detail = thrown?.logMessage ?? "";
    expect(detail).toContain("component");
    expect(detail).toContain("archetype");
    expect(detail).toContain("query");
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
