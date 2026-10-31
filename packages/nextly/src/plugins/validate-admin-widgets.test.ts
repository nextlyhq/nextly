/**
 * Startup refuses a plugin that adds widgets or widget data sources through
 * `contributes.admin.widgets` or `contributes.widgetSources`, naming the
 * plugin, the key and the replacement.
 *
 * Below that gate, what a plugin carries under `admin.widgets` is still
 * reduced before `buildPluginAdminMeta` serializes it into
 * `/api/admin-meta/workspace`, so a value that `JSON.stringify` cannot carry
 * does not break the whole authenticated workspace response, for every admin.
 * Those cases call the reduction directly, with plugins built as plain
 * JavaScript hands them over: the key is no field of the contributions type.
 */
import { afterEach, describe, expect, it } from "vitest";

import { canonicalWidgets } from "../domains/widgets/canonical";
import { clearWidgets, registerWidget } from "../domains/widgets/registry";
import { NextlyError } from "../errors/nextly-error";

import { buildPluginAdminMeta } from "./admin-meta";
import { definePlugin, type PluginDefinition } from "./plugin-context";
import { resolvePlugins } from "./resolve";
import {
  assertAdminWidgets,
  contributedWidgetSummaries,
  validatedAdminWidgets,
} from "./validate-admin-widgets";

/**
 * A real admin route, so the fixtures do not teach a URL that resolves nowhere.
 *
 * The admin registers entry creation as `/admin/collections/[slug]/create`; the
 * `/admin/<collection>/new` shape these fixtures once used is not a route.
 */
const NEW_ENTRY_HREF = "/admin/collections/posts/create";

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
    assertAdminWidgets([...plugins]);
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

describe("a widget id cannot arrive through both a registration and a contribution", () => {
  // A registration and a contribution sharing an id were merged field by field:
  // the contribution's Collection setting kept beside the registration's
  // query, which that setting does not drive, so the setting showed on the
  // card's settings while deciding nothing about what it reads.
  const contribution = withWidget({
    id: "acme/pinned",
    archetype: "metric",
    query: { source: "collection:posts", op: "count" },
    settings: [{ name: "source", label: "Collection", type: "collection" }],
  });

  afterEach(() => {
    clearWidgets();
  });

  it("refuses at startup the contribution a registration would merge over", () => {
    registerWidget(
      {
        id: "acme/pinned",
        title: "Pinned",
        archetype: "metric",
        size: { default: { w: 3, h: 2 } },
        query: { source: "single:homepage", op: "count" },
      },
      { source: "@acme/app" }
    );

    // The control: handed to the merge, the pair still forms the mixed widget,
    // so what stops it below is the gate and not a merge that changed.
    const merged = canonicalWidgets(
      contributedWidgetSummaries([contribution])
    ).find(widget => widget.id === "acme/pinned");
    expect(merged?.collectionSetting?.name).toBe("source");
    expect(merged?.knobQueries).toEqual([
      { source: "single:homepage", op: "count" },
    ]);

    // Startup refuses the plugin carrying it, and a plugin that passes
    // startup contributes nothing to the merge: the registration is the
    // widget, with no Collection setting.
    expect(startupRefusal([contribution])?.logContext).toEqual({
      plugin: "@acme/p",
      key: "contributes.admin.widgets",
    });
    expect(startupRefusal([declaring])).toBeUndefined();
    expect(contributedWidgetSummaries([declaring])).toEqual([]);
    const alone = canonicalWidgets(
      contributedWidgetSummaries([declaring])
    ).find(widget => widget.id === "acme/pinned");
    expect(alone).toBeDefined();
    expect(alone?.collectionSetting).toBeUndefined();
  });
});

describe("widgets carried under admin.widgets are checked before they are published", () => {
  it("names the plugin and the widget in the failure", () => {
    let thrown: unknown;
    try {
      validatedAdminWidgets(withWidget(bigintWidget));
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
      validatedAdminWidgets(
        withWidget({
          id: "acme/since",
          component: "@acme/p/admin#Since",
          query: {
            source: "collection:posts",
            op: "count",
            where: { createdAt: { greater_than: new Date() } },
          },
        })
      )
    ).toThrow(NextlyError);
  });

  it("checks a DISABLED plugin's widgets too", () => {
    // `buildPluginAdminMeta` withholds a disabled plugin's widgets, so this is
    // belt-and-braces -- but enabling the plugin must not be what turns a
    // healthy install into a 500.
    expect(() =>
      validatedAdminWidgets({
        ...withWidget(bigintWidget),
        enabled: false,
      } as PluginDefinition)
    ).toThrow(NextlyError);
  });

  it("lets an ordinary widget through", () => {
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/revenue",
          component: "@acme/p/admin#Revenue",
          size: { default: { w: 6, h: 4 } },
          query: {
            source: "collection:posts",
            op: "count",
            where: { status: { equals: "published" } },
          },
        })
      )
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
      validatedAdminWidgets(withWidget({ id: "stats", component: "" }))
    ).toThrow(NextlyError);
  });

  it("refuses a widget whose component is only whitespace", () => {
    // A path made of spaces resolves no better than an empty one, which is the
    // same reading `validateWidgetDefinition` takes of a `custom` widget's
    // component.
    expect(() =>
      validatedAdminWidgets(withWidget({ id: "stats", component: "   " }))
    ).toThrow(NextlyError);
  });

  it("refuses a widget that describes no body at all", () => {
    // Neither a component to draw it nor an archetype-and-query for core to
    // draw it from. Both routes are closed, so nothing can render this.
    expect(() => validatedAdminWidgets(withWidget({ id: "stats" }))).toThrow(
      NextlyError
    );
  });

  it("accepts a DECLARATIVE widget that ships no component", () => {
    // Tier 1, and the reason this gate changed. The host draws the card from
    // the archetype and the query; requiring a component here made the tier the
    // whole widget query contract exists for impossible to declare, and forced
    // an author to name a component core would never resolve.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/posts",
          title: "Published posts",
          archetype: "metric",
          size: { default: { w: 3, h: 2 } },
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).not.toThrow();
  });

  it("refuses a declarative archetype that brings no query", () => {
    // The pair is the unit. Core draws every archetype but `custom` FROM A
    // QUERY RESULT, so an archetype alone describes a card core can never fill:
    // no request is made for it, no slot arrives, and the grid reads that
    // absence as still loading for the life of the page.
    expect(() =>
      validatedAdminWidgets(
        withWidget({ id: "acme/posts", archetype: "metric" })
      )
    ).toThrow(NextlyError);
  });

  it("refuses `custom` with no component, which is the one archetype that needs one", () => {
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/panel",
          archetype: "custom",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).toThrow(NextlyError);
  });

  it("ACCEPTS an archetype this core does not know", () => {
    // Forward compatibility: the reachable cause is a plugin built against a
    // newer core, and the grid already reports a card it cannot draw, by
    // name, in the card's own place. The blast-radius argument behind the
    // refusals in this file is about a widget that breaks the workspace
    // payload for every admin; an unrecognised archetype is perfectly
    // serializable.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/posts",
          archetype: "metrics",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).not.toThrow();
  });
  it("refuses a whitespace-only component even when the declarative half is valid", () => {
    // The admin resolver reads `component` for TRUTHINESS, so a whitespace
    // string won the archetype fallback, reached `PluginSlot` as a path nothing
    // resolves, and drew a blank card where the archetype's own diagnostic
    // belonged. An absent component is a choice; an unusable one is a mistake.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/posts",
          archetype: "metric",
          query: { source: "collection:posts", op: "count" },
          component: "   ",
        })
      )
    ).toThrow(NextlyError);
  });

  it("still accepts a declarative widget that OMITS the component", () => {
    // The control: absent is fine, unusable is not.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/posts",
          archetype: "metric",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).not.toThrow();
  });

  it("refuses a contributed action missing its label or href", () => {
    // A JavaScript plugin or a decoded manifest reaches this check with nothing
    // enforced by the type. Checking only that the array was non-empty let
    // `actions: [{}]` through, and the admin drew a blank link with an
    // undefined destination -- while a REGISTERED widget carrying the same
    // shortcut was refused. One contract, two channels, one rule.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{}],
        })
      )
    ).toThrow(NextlyError);

    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post" }],
        })
      )
    ).toThrow(NextlyError);
  });

  it("refuses a malformed shortcut even when a component is ALSO supplied", () => {
    // The per-action rule ran only as the fallback for a widget that described
    // no component, so naming one skipped it -- and a component on an `actions`
    // widget is a FALLBACK for an admin too old to draw the archetype, not a
    // replacement for it. A current admin draws the shortcuts itself, from the
    // same malformed array the gate declined to read, and renders the blank
    // link the check beside this one exists to prevent.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          component: "@acme/p/admin#Shortcuts",
          actions: [{}],
        })
      )
    ).toThrow(NextlyError);
  });

  it("still accepts a COMPLETE shortcut list beside a component", () => {
    // The control for the refusal above. A gate that refused every `actions`
    // widget carrying a component would satisfy that assertion while making the
    // fallback -- the whole reason a plugin ships one -- undeclarable.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          component: "@acme/p/admin#Shortcuts",
          actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
        })
      )
    ).not.toThrow();
  });

  it("leaves a DATA archetype's component fallback alone when it has no query", () => {
    // The bound on that refusal. Core draws a queryless archetype from the
    // declaration unconditionally, so the declaration has to be sound there;
    // a `metric` missing its query is a card core reports as undrawable, and
    // the component is then the body that actually renders. Holding the two
    // halves to one rule would reject a widget which draws correctly today.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/revenue",
          archetype: "metric",
          component: "@acme/p/admin#Revenue",
        })
      )
    ).not.toThrow();
  });

  it("refuses a query on a queryless archetype, as the registry does", () => {
    // The registry contract forbids a query on `text`/`actions`, and this
    // channel accepted one -- so a contributed widget could carry a query the
    // registry would have refused. Not merely inconsistent: core draws
    // `actions` from the declaration, so the grid batched a read on every mount
    // and refetch whose result the declared renderer never looks at.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).toThrow(NextlyError);

    // The other queryless archetype, so the rule is the vocabulary's rather
    // than one arm's.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/note",
          archetype: "text",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).toThrow(NextlyError);
  });

  it("refuses that query even behind a component fallback", () => {
    // Same bypass the shortcut rule had: the component short-circuit must not
    // skip a declaration core will draw from.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          component: "@acme/p/admin#Shortcuts",
          actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).toThrow(NextlyError);
  });

  it("leaves a DATA archetype's query alone", () => {
    // The bound. The refusal is the queryless vocabulary's, not a ban on
    // queries -- a `metric` is drawn FROM one.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/revenue",
          archetype: "metric",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).not.toThrow();
  });

  it("refuses a defaultOrder this channel cannot sort by", () => {
    // The registry refuses a non-finite order; this channel had no check at
    // all. `NaN` compares false against every value, so a widget carrying one
    // sorted as equal to whatever it met and the explicit orders around it
    // stopped holding -- intermittently, depending on the order the array
    // happened to arrive in, which is the worst way for it to fail.
    for (const defaultOrder of ["soon", Number.NaN, null, {}]) {
      expect(() =>
        validatedAdminWidgets(
          withWidget({
            id: "acme/shortcuts",
            archetype: "actions",
            actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
            defaultOrder,
          })
        )
      ).toThrow(NextlyError);
    }
  });

  it("accepts a finite order", () => {
    // The control. A gate refusing every order would satisfy the assertion
    // above while making the field undeclarable.
    for (const defaultOrder of [0, -1, 2.5]) {
      expect(() =>
        validatedAdminWidgets(
          withWidget({
            id: "acme/shortcuts",
            archetype: "actions",
            actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
            defaultOrder,
          })
        )
      ).not.toThrow();
    }
  });

  it("accepts a widget that states no order at all", () => {
    // OMITTED, not `defaultOrder: undefined`. An explicitly undefined value is
    // refused on every field here, `description` and `icon` included, because
    // it does not survive the JSON round trip this gate runs -- so writing the
    // absent case that way would assert the serialization rule rather than
    // this one.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
        })
      )
    ).not.toThrow();
  });

  it("refuses a widget that names chrome, whatever its value", () => {
    // Every card is drawn in the dashboard's one frame, so no widget may
    // decline it. Refused rather than ignored, so a plain-JavaScript author
    // learns at startup that their card will be framed.
    // Asserted on `logMessage`, where the detail goes: `.message` is the
    // generic public one, which any refusal would match.
    for (const chrome of ["none", "card"]) {
      let thrown: NextlyError | undefined;
      try {
        validatedAdminWidgets(
          withWidget({
            id: "acme/thing",
            archetype: "custom",
            component: "@acme/p/admin#Thing",
            chrome,
          })
        );
      } catch (error) {
        thrown = error as NextlyError;
      }
      expect(thrown, chrome).toBeInstanceOf(NextlyError);
      expect(thrown?.logMessage, chrome).toContain(
        "chrome is not a widget field"
      );
    }
  });

  it("accepts the same widget with no chrome", () => {
    // The control: a gate refusing every custom widget would satisfy the
    // assertion above.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/thing",
          archetype: "custom",
          component: "@acme/p/admin#Thing",
        })
      )
    ).not.toThrow();
  });

  it("accepts a contributed actions widget whose shortcuts are complete", () => {
    // The control. A gate that refused every actions widget would satisfy the
    // assertions above while making the archetype undeclarable.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/shortcuts",
          archetype: "actions",
          actions: [{ label: "New post", href: NEW_ENTRY_HREF }],
        })
      )
    ).not.toThrow();
  });

  it("names BOTH routes in the diagnostic an author actually reads", () => {
    // The author has two ways out and the sentence has to say so, or the
    // obvious reading is that the old component-or-nothing rule still stands.
    //
    // Asserted on `logMessage`, which is where this factory puts the detail --
    // `publicMessage` is deliberately generic. A test reading `.message` passes
    // against any refusal at all and says nothing about what the author is
    // told, which is the entire point of failing rather than dropping
    // the widget.
    let thrown: NextlyError | undefined;
    try {
      validatedAdminWidgets(withWidget({ id: "stats" }));
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
      validatedAdminWidgets(
        withWidget({ id: "  ", component: "@acme/p/admin#Stats" })
      )
    ).toThrow(NextlyError);
    expect(() =>
      validatedAdminWidgets(withWidget({ component: "@acme/p/admin#Stats" }))
    ).toThrow(NextlyError);
  });

  it("refuses a component that is not a string", () => {
    // JSON carries a number happily, so the round trip has nothing to say
    // about it.
    expect(() =>
      validatedAdminWidgets(withWidget({ id: "stats", component: 7 }))
    ).toThrow(NextlyError);
  });

  it("refuses a setting's own editor, naming the widget and the setting", () => {
    // Only a defineWidget declaration's editors reach the generated component
    // map, so one contributed here would be drawn "unavailable" for everyone.
    let thrown: unknown;
    try {
      validatedAdminWidgets(
        withWidget({
          id: "acme/goal",
          component: "@acme/p/admin#Goal",
          settings: [
            {
              name: "goal",
              label: "Goal",
              type: "number",
              editor: { component: "@acme/p/admin#GoalEditor" },
            },
          ],
        })
      );
    } catch (error) {
      thrown = error;
    }
    expect(NextlyError.is(thrown)).toBe(true);
    const logged = (thrown as NextlyError).logMessage;
    expect(logged).toContain('admin widget "acme/goal"');
    expect(logged).toContain(
      'setting "goal" declares an editor: custom setting editors need a defineWidget declaration'
    );

    // The must-differ half: the same widget, its setting drawn by its own field.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/goal",
          component: "@acme/p/admin#Goal",
          settings: [{ name: "goal", label: "Goal", type: "number" }],
        })
      )
    ).not.toThrow();
  });

  it("names the plugin and the widget in the shape failure too", () => {
    // The same diagnostic the JSON refusal gives, so an author reading a
    // failure can find the entry whichever way it was malformed.
    let thrown: unknown;
    try {
      validatedAdminWidgets(withWidget({ id: "stats", component: "" }));
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
      validatedAdminWidgets(
        withWidget({ id: "stats", component: "@acme/p/admin#Stats" })
      )
    ).not.toThrow();
  });

  it("accepts a widget declaring no title, archetype or size", () => {
    // The other half of that control. Those three are REQUIRED on a
    // `WidgetDefinition` and OPTIONAL on a `PluginAdminWidget`, so borrowing
    // the definition validator here would reject the shape this file exists to
    // check.
    expect(() =>
      validatedAdminWidgets(
        withWidget({ id: "stats", component: "@acme/p/admin#Stats" })
      )
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

describe("the serializer cannot publish what the check refuses", () => {
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
          size: { default: { w: 6, h: 4 } },
        }),
      ],
      undefined
    );
    expect(meta[0].widgets).toHaveLength(1);
    expect(() => JSON.stringify(meta)).not.toThrow();
  });
});

describe("a contributed widget draws the result its archetype can draw", () => {
  it("refuses a metric contributed with a grouped query", () => {
    // The registry already refused this pairing; contributions reach the admin
    // through `validatedAdminWidgets` instead, so the guarantee had to be
    // applied to BOTH doors or plugin authors would get neither the compile
    // error nor the boot one -- and the card would register, execute, and be
    // replaced by the body's "expected a count" message on every load.
    let thrown: unknown;
    try {
      validatedAdminWidgets(
        withWidget({
          id: "acme/by-status",
          archetype: "metric",
          query: {
            source: "collection:posts",
            op: "groupBy",
            groupBy: "status",
          },
        })
      );
    } catch (error) {
      thrown = error;
    }

    expect(NextlyError.is(thrown)).toBe(true);
    expect((thrown as NextlyError).logMessage).toContain("acme/by-status");
    expect((thrown as NextlyError).logMessage).toContain("groupBy");
  });

  it("accepts an inherited property name as an archetype instead of crashing on it", () => {
    // An unknown archetype is admitted on purpose -- it is how a plugin built
    // against a NEWER core keeps working -- so the right outcome here is a
    // clean pass, not a refusal.
    //
    // The defect was the route to it. A contribution's archetype is caller
    // text, and indexed into an OBJECT LITERAL `"toString"` answers with a
    // prototype method rather than `undefined`: the lookup found a truthy
    // "result set", called `.has()` on a function, and threw a TypeError that
    // aborted plugin resolution. A `Map` cannot be reached that way, so the
    // unknown archetype takes the path meant for it.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/proto",
          archetype: "toString",
          component: "@acme/p/admin#Proto",
          query: { source: "collection:posts", op: "count" },
        })
      )
    ).not.toThrow();
  });

  it("admits a custom widget carrying the same query", () => {
    // The control, and the point: a component receives the result whole and
    // decides what to draw, so constraining its op would be core guessing at a
    // plugin's intent.
    expect(() =>
      validatedAdminWidgets(
        withWidget({
          id: "acme/chart",
          component: "@acme/p/admin#Chart",
          query: {
            source: "collection:posts",
            op: "groupBy",
            groupBy: "status",
          },
        })
      )
    ).not.toThrow();
  });
});

describe("a carried widget's size, judged before it is published", () => {
  /** The detail a refused contribution's error carries, or `undefined` when it passed. */
  function refusal(size: unknown): string | undefined {
    try {
      validatedAdminWidgets(
        withWidget({ id: "acme/w", component: "@acme/p/admin#W", size })
      );
      return undefined;
    } catch (error) {
      expect(error).toBeInstanceOf(NextlyError);
      return (error as NextlyError).logMessage;
    }
  }

  it("refuses a default above its own maximum, as the registry does", () => {
    // 🔴 The same check both channels ask (`sizeDeclarationProblems`), so a
    // card cannot start at a size its reader may not return it to on one
    // channel while the other refuses it.
    expect(refusal({ default: { w: 8, h: 4 }, max: { w: 6, h: 4 } })).toContain(
      "size.default must not be larger than size.max"
    );
  });

  it("refuses a minimum above its default", () => {
    expect(refusal({ default: { w: 4, h: 3 }, min: { w: 6, h: 3 } })).toContain(
      "size.min must not be larger than size.default"
    );
  });

  it("refuses a width outside the twelve columns", () => {
    expect(refusal({ default: { w: 13, h: 4 } })).toContain(
      "size.default.w must be a whole number from 1 to 12"
    );
  });

  it("refuses a named width in place of a size", () => {
    expect(refusal("full")).toContain(
      "size must be { default: { w, h }, min?, max? }"
    );
  });

  it("accepts a size within its own bounds", () => {
    expect(
      refusal({
        default: { w: 6, h: 4 },
        min: { w: 4, h: 3 },
        max: { w: 12, h: 6 },
      })
    ).toBeUndefined();
  });
});
