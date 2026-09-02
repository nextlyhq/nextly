/**
 * Which DEFINITION a widget is drawn from when both channels declare its id.
 *
 * Covered here rather than through `WidgetGrid`, because the question is about
 * the resolver's answer and a grid test can only see it through whatever the
 * archetype happened to render. The permission case in particular has no
 * visible difference to assert on: both outcomes draw nothing, and only the
 * returned list says whether that was the tightened rule being honoured or the
 * widget being absent for some other reason.
 */
import { describe, expect, it } from "vitest";

import type {
  PluginMetadata,
  RegisteredWidgetMeta,
} from "@admin/types/branding";

import { resolveDashboardWidgets } from "../resolve-widgets";
import { WIDGET_SPAN_CLASSES, widgetSpanClass } from "../sizes";

const allow = () => true;
const deny = () => false;

function contributing(widgets: unknown[]): PluginMetadata[] {
  return [
    { name: "@acme", collections: [], widgets },
  ] as unknown as PluginMetadata[];
}

const REGISTERED_SHARED = {
  id: "shared",
  title: "From the registry",
  archetype: "metric",
  defaultSize: "sm",
  query: { source: "collection:posts", op: "count" },
} as unknown as RegisteredWidgetMeta;

describe("resolveDashboardWidgets", () => {
  it("draws a colliding id from the registered definition, not the contribution", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].title).toBe("From the registry");
    // The registry's query is what reaches the batch. The contribution above
    // declares none, so a resolver that preferred it would put no request in
    // flight at all and the card would sit loading forever.
    expect(widgets[0].query).toEqual({
      source: "collection:posts",
      op: "count",
    });
  });

  it("keeps the contribution's POSITION while taking the registry's definition", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
        { id: "second", title: "Second", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets.map(w => w.id)).toEqual(["shared", "second"]);
  });

  it("honours a permission the registry TIGHTENED on a contributed id", () => {
    // The security shape: an operator restricts a widget through
    // `extendWidget`/`overrideWidget`, and the contributed copy carries no
    // permission at all. Preferring the contribution draws the card and puts
    // its query in the batch for a user the running configuration says may not
    // see it.
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "shared", title: "From the contribution", archetype: "metric" },
      ]),
      [
        {
          ...REGISTERED_SHARED,
          requiredPermission: "read-secrets",
        } as unknown as RegisteredWidgetMeta,
      ],
      deny
    );

    expect(widgets).toEqual([]);
  });

  it("keeps the contributed component when the registry names an archetype core cannot draw", () => {
    // `table` because it has no renderer in this release; the point is an
    // archetype core cannot draw, not that particular name. When `table` gains
    // a body this must move to whichever archetype is still undrawn.
    //
    // The population this resolver reads both channels FOR: an app that
    // registered a widget and also contributed it, which is how it got a card
    // before the registry was published at all. `WidgetDefinition` forbids
    // `component` on any archetype but `custom`, so the registration
    // structurally cannot carry one -- and substituting it discarded the only
    // thing on either side that could draw the card, turning a working plugin
    // body into "the list widget archetype is not rendered yet".
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "acme/recent", component: "@acme/admin#RecentList" },
      ]),
      [
        {
          id: "acme/recent",
          title: "Recent posts",
          archetype: "table",
          defaultSize: "md",
          query: { source: "collection:posts", op: "list", limit: 5 },
        } as unknown as RegisteredWidgetMeta,
      ],
      allow
    );

    expect(widgets).toHaveLength(1);
    // Drawn by the plugin, because core has no `list` renderer in this release.
    expect(widgets[0].archetype).toBe("custom");
    expect(widgets[0].component).toBe("@acme/admin#RecentList");
    // And still carrying what only the registry knew.
    expect(widgets[0].title).toBe("Recent posts");
    expect(widgets[0].query).toEqual({
      source: "collection:posts",
      op: "list",
      limit: 5,
    });
  });

  it("still honours a tightened permission on an archetype core cannot draw", () => {
    // The merge must not buy the component back at the cost of the gate: this
    // is the same input as above with the registry restricting it.
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "acme/recent", component: "@acme/admin#RecentList" },
      ]),
      [
        {
          id: "acme/recent",
          title: "Recent posts",
          archetype: "table",
          defaultSize: "md",
          requiredPermission: "read-secrets",
          query: { source: "collection:posts", op: "list", limit: 5 },
        } as unknown as RegisteredWidgetMeta,
      ],
      deny
    );

    expect(widgets).toEqual([]);
  });

  it("drops a duplicate registration whose FIRST entry was withheld", () => {
    // Deduplication and the permission gate must agree about which of the two
    // the payload meant. Resolving the array member rather than the canonical
    // one let the second entry -- carrying no permission -- render in place of
    // the restricted first, and put its query in the batch.
    const widgets = resolveDashboardWidgets(
      undefined,
      [
        { ...REGISTERED_SHARED, requiredPermission: "read-secrets" },
        { ...REGISTERED_SHARED, title: "Second copy" },
      ] as unknown as RegisteredWidgetMeta[],
      deny
    );

    expect(widgets).toEqual([]);
  });

  it("drops a shortcut this reader may not use, keeping the card", () => {
    // The two gates answer different questions and both are needed. The card's
    // own permission decides whether the widget appears; an item's decides
    // whether that shortcut does. A card of shortcuts where the reader may use
    // one should show one, not disappear -- and a shortcut to something they
    // cannot do advertises a capability, costs a click, and answers with a
    // refusal screen.
    const widgets = resolveDashboardWidgets(
      contributing([
        {
          id: "core/shortcuts",
          title: "Shortcuts",
          archetype: "actions",
          actions: [
            { label: "New post", href: "/admin/posts/new" },
            {
              label: "Invite user",
              href: "/admin/users/new",
              requiredPermission: "create-users",
            },
          ],
        },
      ]),
      undefined,
      permission => permission !== "create-users"
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].actions?.map(a => a.label)).toEqual(["New post"]);
  });

  it("keeps every shortcut when the reader may use them all", () => {
    // The positive control. A filter that dropped everything would satisfy the
    // assertion above.
    const widgets = resolveDashboardWidgets(
      contributing([
        {
          id: "core/shortcuts",
          title: "Shortcuts",
          archetype: "actions",
          actions: [
            { label: "New post", href: "/admin/posts/new" },
            {
              label: "Invite user",
              href: "/admin/users/new",
              requiredPermission: "create-users",
            },
          ],
        },
      ]),
      undefined,
      allow
    );

    expect(widgets[0].actions).toHaveLength(2);
  });

  it("still renders a contribution the registry knows nothing about", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "only-contributed", title: "Contributed", archetype: "metric" },
      ]),
      [REGISTERED_SHARED],
      allow
    );

    expect(widgets.map(w => w.id)).toEqual(["only-contributed", "shared"]);
  });

  it("drops a duplicate id inside the registry payload itself", () => {
    // The registry is a map and cannot hold two, but this list crossed the
    // wire. Two cells for one id would hand both the same batch slot.
    const widgets = resolveDashboardWidgets(
      undefined,
      [
        REGISTERED_SHARED,
        { ...REGISTERED_SHARED, title: "Second copy" },
      ] as unknown as RegisteredWidgetMeta[],
      allow
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].title).toBe("From the registry");
  });
});

describe("defaultOrder decides position, and only where it is stated", () => {
  const card = (id: string, extra: Record<string, unknown> = {}) =>
    ({
      id,
      title: id,
      archetype: "text",
      defaultSize: "sm",
      ...extra,
    }) as unknown as RegisteredWidgetMeta;

  const ids = (widgets: { id: string }[]) => widgets.map(w => w.id);

  it("lifts a stating widget above one that states nothing", () => {
    // The registry channel is read AFTER contributions, so `last` would
    // otherwise be last whatever it declared -- which is the accident this
    // field exists to remove.
    const widgets = resolveDashboardWidgets(
      contributing([card("contributed-a"), card("contributed-b")]),
      [card("last", { defaultOrder: 0 })],
      allow
    );
    expect(ids(widgets)).toEqual(["last", "contributed-a", "contributed-b"]);
  });

  it("orders several statements among themselves, ascending", () => {
    const widgets = resolveDashboardWidgets(
      contributing([
        card("third", { defaultOrder: 3 }),
        card("first", { defaultOrder: -1 }),
        card("second", { defaultOrder: 1.5 }),
      ]),
      [],
      allow
    );
    expect(ids(widgets)).toEqual(["first", "second", "third"]);
  });

  it("puts an omitted order after EVERY value validation accepts", () => {
    // `MAX_SAFE_INTEGER` is not the largest finite number, and the validator
    // accepts any finite one -- so a widget declaring `Number.MAX_VALUE` sorted
    // AFTER widgets that declared nothing, contradicting the guarantee that an
    // omitted order goes last. The sentinel has to sit above the accepted
    // range, not merely above the numbers anyone expects.
    const widgets = resolveDashboardWidgets(
      contributing([
        card("huge", { defaultOrder: Number.MAX_VALUE }),
        card("none"),
      ]),
      [],
      allow
    );
    expect(ids(widgets)).toEqual(["huge", "none"]);
  });

  it("leaves widgets that state nothing in the order they already had", () => {
    // The compatibility bound, and the reason the sort has to be STABLE: every
    // widget shipping today declares no order, so an unstable comparator would
    // rearrange every existing dashboard while every assertion above still
    // passed.
    const widgets = resolveDashboardWidgets(
      contributing([card("a"), card("b"), card("c"), card("d")]),
      [],
      allow
    );
    expect(ids(widgets)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("a widget declared through BOTH channels keeps its new fields", () => {
  const ids = (widgets: { id: string }[]) => widgets.map(w => w.id);

  it("carries defaultOrder and chrome through the collision merge", () => {
    // `mergeCollision` rebuilds the widget field by field, so a field added to
    // the contract and not to it is silently dropped -- the dual-channel widget
    // loses its declared position and an unframed custom widget is wrapped in a
    // card it asked not to have. Same shape as the result parser that dropped
    // `fields` when the result contract grew.
    const contribution = {
      id: "shared",
      title: "Shared",
      archetype: "custom",
      defaultSize: "sm",
      component: "@acme/p/admin#X",
      defaultOrder: 5,
      chrome: "none",
    } as unknown as RegisteredWidgetMeta;

    const registration = {
      id: "shared",
      title: "Shared",
      archetype: "custom",
      defaultSize: "sm",
      component: "@acme/p/admin#X",
      defaultOrder: 1,
      chrome: "none",
    } as unknown as RegisteredWidgetMeta;

    const [widget] = resolveDashboardWidgets(
      contributing([contribution]),
      [registration],
      allow
    );

    // The registry is authoritative over a field it can state, which is the
    // rule `defaultSize` already follows here.
    expect(widget.defaultOrder).toBe(1);
    expect(widget.chrome).toBe("none");
  });

  it("sorts the merged widget by the order it kept", () => {
    // The consequence, asserted on the OUTCOME rather than on the merged
    // object: a dropped order is invisible until something reads it.
    const merged = {
      id: "shared",
      title: "Shared",
      archetype: "text",
      defaultSize: "sm",
      defaultOrder: 0,
    } as unknown as RegisteredWidgetMeta;

    const widgets = resolveDashboardWidgets(
      contributing([
        { id: "first", title: "f", archetype: "text", defaultSize: "sm" },
        merged,
      ] as unknown as RegisteredWidgetMeta[]),
      [merged],
      allow
    );
    expect(ids(widgets)).toEqual(["shared", "first"]);
  });
});

describe("an unknown size survives, including the inherited names", () => {
  it("falls back to full width for a size from a newer core", () => {
    expect(widgetSpanClass("enormous" as never)).toBe(WIDGET_SPAN_CLASSES.full);
  });

  it("falls back for names that exist on Object.prototype", () => {
    // A plain `obj[key] ?? fallback` returns the INHERITED member for these, so
    // the fallback never runs and the grid receives a function or an object
    // where it expected a class list. The value reaches here from a plugin
    // declaration over the wire, so any string is possible.
    for (const size of ["constructor", "toString", "valueOf", "__proto__"]) {
      expect(widgetSpanClass(size as never)).toBe(WIDGET_SPAN_CLASSES.full);
    }
  });

  it("still returns the real class for a size this core knows", () => {
    // The control. A function returning the fallback unconditionally would
    // satisfy both assertions above while collapsing every widget to full width.
    expect(widgetSpanClass("sm")).toBe(WIDGET_SPAN_CLASSES.sm);
  });
});

describe("two contributions sharing one widget id", () => {
  /** One plugin's contribution, as `/api/admin-meta` serializes it. */
  function contributing(widget: Record<string, unknown>) {
    return { name: "@acme/p", widgets: [widget] } as never;
  }

  it("does not let a later UNGATED declaration render where a gated one was withheld", () => {
    // 🔴 Widget ids are plugin-local, so two enabled plugins can ship the same
    // one. The resolver used to pass the id on when a declaration was declined,
    // so a second plugin contributing that id with no `requiredPermission`
    // rendered exactly where the first plugin's gated widget had been withheld.
    // Nothing enforced agreement between the two declarations.
    const widgets = resolveDashboardWidgets(
      [
        contributing({
          id: "dup/one",
          title: "Gated",
          archetype: "custom",
          component: "p#A",
          requiredPermission: "read-secrets",
        }),
        contributing({
          id: "dup/one",
          title: "Ungated",
          archetype: "custom",
          component: "p#B",
        }),
      ],
      [],
      () => false
    );

    expect(widgets).toEqual([]);
  });

  it("resolves the id to the FIRST declaration, matching the server", () => {
    // The control, and the agreement that matters. `canonicalWidgets` resolves
    // a collision by declaration order alone -- it must, because default
    // positions come from the whole-registry materialization and a caller-
    // dependent identity would move every reader's cards. A grid that chose
    // differently would draw one declaration where the server placed another.
    const widgets = resolveDashboardWidgets(
      [
        contributing({
          id: "dup/one",
          title: "First",
          archetype: "custom",
          component: "p#A",
        }),
        contributing({
          id: "dup/one",
          title: "Second",
          archetype: "custom",
          component: "p#B",
        }),
      ],
      [],
      () => true
    );

    expect(widgets.map(w => w.title)).toEqual(["First"]);
  });
});
