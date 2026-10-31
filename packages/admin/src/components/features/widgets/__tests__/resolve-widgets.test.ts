/**
 * How each widget the registry publishes is drawn, and which entry an id names.
 *
 * Covered here rather than through `WidgetGrid`, because the question is about
 * the resolver's answer and a grid test can only see it through whatever the
 * archetype happened to render. The permission case in particular has no
 * visible difference to assert on: both outcomes draw nothing, and only the
 * returned list says whether that was the rule being honoured or the widget
 * being absent for some other reason.
 */
import { UNSTATED_WIDGET_SIZE, sizeBounds } from "nextly/config";
import { describe, expect, it } from "vitest";

import type { RegisteredWidgetMeta } from "@admin/types/branding";

import { resolveDashboardWidgets } from "../resolve-widgets";

const allow = () => true;
const deny = () => false;

const REGISTERED_SHARED = {
  id: "shared",
  title: "From the registry",
  archetype: "metric",
  size: { default: { w: 3, h: 3 } },
  query: { source: "collection:posts", op: "count" },
} as unknown as RegisteredWidgetMeta;

/** A registered widget drawn by its own component, with `extra` beside it. */
const drawnBy = (id: string, extra: Record<string, unknown> = {}) =>
  ({
    id,
    title: id,
    archetype: "custom",
    component: `@acme/p/admin#${id}`,
    size: { default: { w: 3, h: 3 } },
    ...extra,
  }) as unknown as RegisteredWidgetMeta;

describe("resolveDashboardWidgets", () => {
  it("carries a registered widget's sketch, which its loading state is drawn as", () => {
    const declared = {
      id: "acme/orders",
      title: "Orders",
      archetype: "custom",
      component: "acme#Orders",
      serverData: true,
      sketch: "bars",
      size: { default: { w: 4, h: 3 } },
    } as unknown as RegisteredWidgetMeta;
    const [widget] = resolveDashboardWidgets([declared], allow);
    expect(widget?.sketch).toBe("bars");
    // The control: a registration naming none carries none.
    const [plain] = resolveDashboardWidgets([REGISTERED_SHARED], allow);
    expect(plain).not.toHaveProperty("sketch");
  });

  it("names who declared a widget drawn by its own component, as core published it", () => {
    const widgets = resolveDashboardWidgets(
      [drawnBy("acme/own", { owner: 'plugin "@acme"' }), REGISTERED_SHARED],
      allow
    );
    expect(widgets.find(each => each.id === "acme/own")?.owner).toBe(
      'plugin "@acme"'
    );
    expect(widgets.find(each => each.id === "shared")?.owner).toBeUndefined();
  });

  it("carries the filters core published for a registered widget", () => {
    // The knobs build a card's query from these, so a widget reading across
    // collections that lost them would have its Collection setting replace its
    // source instead of narrowing it.
    const edits = {
      ...REGISTERED_SHARED,
      id: "edits",
      archetype: "list",
      query: { source: "system:edits", op: "list" },
      sourceFilters: ["collection", "onlyMine"],
    } as unknown as RegisteredWidgetMeta;
    const [widget] = resolveDashboardWidgets([edits], allow);
    expect(widget?.sourceFilters).toEqual(["collection", "onlyMine"]);
  });

  it("withholds a widget whose permission this reader lacks, and keeps it for one who holds it", () => {
    const gated = {
      ...REGISTERED_SHARED,
      requiredPermission: "read-secrets",
    } as unknown as RegisteredWidgetMeta;
    expect(resolveDashboardWidgets([gated], deny)).toEqual([]);
    expect(resolveDashboardWidgets([gated], allow)).toHaveLength(1);
  });

  it("drops a duplicate registration whose FIRST entry was withheld", () => {
    // Deduplication and the permission gate must agree about which of the two
    // the payload meant: the second entry, carrying no permission, must not
    // render in place of the restricted first and put its query in the batch.
    const widgets = resolveDashboardWidgets(
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
    // whether that shortcut does.
    const shortcuts = {
      id: "core/shortcuts",
      title: "Shortcuts",
      archetype: "actions",
      size: { default: { w: 3, h: 3 } },
      actions: [
        { label: "New post", href: "/admin/posts/new" },
        {
          label: "Invite user",
          href: "/admin/users/new",
          requiredPermission: "create-users",
        },
      ],
    } as unknown as RegisteredWidgetMeta;
    const widgets = resolveDashboardWidgets(
      [shortcuts],
      permission => permission !== "create-users"
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].actions?.map(a => a.label)).toEqual(["New post"]);
    // The positive control: a filter that dropped everything would satisfy
    // the assertion above.
    expect(resolveDashboardWidgets([shortcuts], allow)[0].actions).toHaveLength(
      2
    );
  });

  it("drops a duplicate id inside the registry payload itself", () => {
    // The registry is a map and cannot hold two, but this list crossed the
    // wire. Two cells for one id would hand both the same batch slot.
    const widgets = resolveDashboardWidgets(
      [
        REGISTERED_SHARED,
        { ...REGISTERED_SHARED, title: "Second copy" },
      ] as unknown as RegisteredWidgetMeta[],
      allow
    );

    expect(widgets).toHaveLength(1);
    expect(widgets[0].title).toBe("From the registry");
  });

  it("draws nothing before the registry arrives", () => {
    expect(resolveDashboardWidgets(undefined, allow)).toEqual([]);
  });
});

describe("defaultOrder decides position, and only where it is stated", () => {
  const ids = (widgets: { id: string }[]) => widgets.map(w => w.id);

  it("lifts a stating widget above one that states nothing", () => {
    const widgets = resolveDashboardWidgets(
      [drawnBy("a"), drawnBy("b"), drawnBy("last", { defaultOrder: 0 })],
      allow
    );
    expect(ids(widgets)).toEqual(["last", "a", "b"]);
  });

  it("orders several statements among themselves, ascending", () => {
    const widgets = resolveDashboardWidgets(
      [
        drawnBy("third", { defaultOrder: 3 }),
        drawnBy("first", { defaultOrder: -1 }),
        drawnBy("second", { defaultOrder: 1.5 }),
      ],
      allow
    );
    expect(ids(widgets)).toEqual(["first", "second", "third"]);
  });

  it("puts an omitted order after EVERY value validation accepts", () => {
    // `MAX_SAFE_INTEGER` is not the largest finite number, and the validator
    // accepts any finite one, so the sentinel has to sit above the accepted
    // range, not merely above the numbers anyone expects.
    const widgets = resolveDashboardWidgets(
      [drawnBy("huge", { defaultOrder: Number.MAX_VALUE }), drawnBy("none")],
      allow
    );
    expect(ids(widgets)).toEqual(["huge", "none"]);
  });

  it("leaves widgets that state nothing in the order they were published in", () => {
    // The reason the sort has to be STABLE: an unstable comparator would
    // rearrange every dashboard while every assertion above still passed.
    const widgets = resolveDashboardWidgets(
      [drawnBy("a"), drawnBy("b"), drawnBy("c"), drawnBy("d")],
      allow
    );
    expect(ids(widgets)).toEqual(["a", "b", "c", "d"]);
  });
});

describe("who may send a card away travels with the declaration", () => {
  it("carries dismissible from a registration", () => {
    const [widget] = resolveDashboardWidgets(
      [drawnBy("core/onboarding", { dismissible: true })],
      allow
    );

    expect(widget.dismissible).toBe(true);
  });

  it("leaves a card that declared nothing without the field", () => {
    // The control is drawn on the strength of this field, so a resolver that
    // defaulted it to `true` would put a dismiss button on every card.
    const [widget] = resolveDashboardWidgets([drawnBy("acme/plain")], allow);

    expect(widget.dismissible).toBeUndefined();
  });
});

describe("a widget's size bounds, resolved once", () => {
  it("fills in a registration's bounds through core's own rule", () => {
    const [widget] = resolveDashboardWidgets(
      [
        {
          ...REGISTERED_SHARED,
          size: { default: { w: 6, h: 3 }, min: { w: 4, h: 2 } },
        } as unknown as RegisteredWidgetMeta,
      ],
      allow
    );
    // The minimum as stated; the maximum the full width at the default's height.
    expect(widget.size).toEqual({
      default: { w: 6, h: 3 },
      min: { w: 4, h: 2 },
      max: { w: 12, h: 3 },
    });
  });

  it("reads a size the grid could not use, or none, as the unstated size", () => {
    // 🔴 A payload over the wire may be anything: a named width, a minimum
    // above its default, a row height of one, or no size at all. None of them
    // is drawn as stated.
    for (const size of [
      undefined,
      "half",
      { default: { w: 4, h: 3 }, min: { w: 6, h: 3 } },
      { default: { w: 4, h: 1 } },
      { default: { w: 13, h: 3 } },
    ]) {
      const [widget] = resolveDashboardWidgets(
        [drawnBy("acme/c", { size })],
        allow
      );
      expect(widget.size, JSON.stringify(size)).toEqual(
        sizeBounds(UNSTATED_WIDGET_SIZE)
      );
    }
  });

  it("keeps a widget's own usable size", () => {
    // The control: a resolver that always answered the unstated size passes the case above.
    const [widget] = resolveDashboardWidgets(
      [drawnBy("acme/c", { size: { default: { w: 4, h: 2 } } })],
      allow
    );
    expect(widget.size.default).toEqual({ w: 4, h: 2 });
  });
});
