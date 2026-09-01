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
