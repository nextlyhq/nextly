/**
 * The one default dashboard, built from one `defaultLayout` whoever wrote it:
 * core's own or the site's, its entries at their sizes and settings, an
 * optional entry left out where its widget is absent, then the plugins'
 * suggestions unless the site turns them off. Varied per person only by the
 * cards each may not see.
 */
import { describe, expect, it } from "vitest";

import type { CanonicalWidget } from "../canonical";
import { CORE_DEFAULT_LAYOUT } from "../core-widgets/ids";
import {
  defaultLayoutPlacements,
  type DefaultLayoutPlan,
} from "../default-layout";
import { partitionPlacements } from "../layout";

/** A widget at a starting size, with what else the case states. */
const widget = (
  id: string,
  patch: Partial<CanonicalWidget> = {}
): CanonicalWidget => ({
  id,
  size: { default: { w: 6, h: 3 }, min: { w: 3, h: 2 }, max: { w: 12, h: 8 } },
  ...patch,
});

const plan = (patch: Partial<DefaultLayoutPlan>): DefaultLayoutPlan => ({
  cards: [],
  suggestions: true,
  suggested: [],
  ...patch,
});

const ids = (widgets: readonly CanonicalWidget[], p: DefaultLayoutPlan) =>
  defaultLayoutPlacements(widgets, p).map(placement => placement.widgetId);

/** Core's own widgets, each at the starting size the case gives none. */
const core = CORE_DEFAULT_LAYOUT.map(card => widget(card.widget));

describe("the base of the default", () => {
  it("is core's own defaultLayout, in its order, each card at its widget's starting size", () => {
    const placements = defaultLayoutPlacements(
      [...core].reverse(),
      plan({ cards: CORE_DEFAULT_LAYOUT })
    );
    expect(placements.map(p => p.widgetId)).toEqual(
      CORE_DEFAULT_LAYOUT.map(card => card.widget)
    );
    expect(placements[0]).toEqual({
      id: "core/get-started",
      widgetId: "core/get-started",
      w: 6,
      h: 3,
      removed: false,
    });
  });

  it("is the site's defaultLayout in place of core's whole, at its sizes and with its settings", () => {
    const placements = defaultLayoutPlacements(
      [...core, widget("acme/orders")],
      plan({
        cards: [
          { widget: "acme/orders", w: 4, settings: { top: 5 } },
          { widget: "core/team", h: 4 },
        ],
      })
    );
    expect(placements).toEqual([
      {
        id: "acme/orders",
        widgetId: "acme/orders",
        w: 4,
        h: 3,
        removed: false,
        config: { top: 5 },
      },
      { id: "core/team", widgetId: "core/team", w: 6, h: 4, removed: false },
    ]);
  });

  it("leaves out an optional entry whose widget is not installed, and places it once it is", () => {
    const cards = [
      { widget: "acme/orders", optional: true },
      { widget: "core/team" },
    ];
    expect(ids(core, plan({ cards }))).toEqual(["core/team"]);
    expect(ids([...core, widget("acme/orders")], plan({ cards }))).toEqual([
      "acme/orders",
      "core/team",
    ]);
  });
});

describe("the plugins' suggestions", () => {
  const cards = [{ widget: "core/team" }];
  const declared = widget("acme/revenue", { serverData: true });

  it("are placed after the base, the named ones in order, then the older shape's by defaultOrder", () => {
    const widgets = [
      ...core,
      declared,
      widget("acme/orders", { serverData: true }),
      widget("old/late", { defaultOrder: 50 }),
      widget("old/none"),
      widget("old/early", { defaultOrder: 5 }),
    ];
    expect(
      ids(widgets, plan({ cards, suggested: ["acme/revenue", "acme/orders"] }))
    ).toEqual([
      "core/team",
      "acme/revenue",
      "acme/orders",
      "old/early",
      "old/late",
      "old/none",
    ]);
  });

  it("place nothing the base already places, and never another of core's widgets", () => {
    const widgets = [...core, declared];
    expect(
      ids(
        widgets,
        plan({
          cards: [{ widget: "acme/revenue" }, { widget: "core/team" }],
          suggested: ["acme/revenue"],
        })
      )
    ).toEqual(["acme/revenue", "core/team"]);
  });

  it("leave out what is offered and never placed: a declared widget no plugin suggests, a generated card, one offered per collection", () => {
    const widgets = [
      ...core,
      declared,
      widget("collection/posts-count", { generated: true }),
      widget("acme/per-collection", { offered: "per-collection" }),
    ];
    expect(ids(widgets, plan({ cards }))).toEqual(["core/team"]);
  });

  it("are all ignored when the site sets suggestions: false", () => {
    const widgets = [...core, declared, widget("old/card")];
    expect(
      ids(
        widgets,
        plan({ cards, suggestions: false, suggested: ["acme/revenue"] })
      )
    ).toEqual(["core/team"]);
  });
});

describe("one default for everyone", () => {
  it("differs between two people only by the cards each may not see", () => {
    const widgets = [...core, widget("acme/orders")];
    const placements = defaultLayoutPlacements(
      widgets,
      plan({ cards: [...CORE_DEFAULT_LAYOUT, { widget: "acme/orders" }] })
    );
    const everything = new Set(widgets.map(each => each.id));
    // The second person may not see the team or the plugin's widget.
    const fewer = new Set(
      [...everything].filter(id => id !== "core/team" && id !== "acme/orders")
    );
    const first = partitionPlacements(placements, everything).visible;
    const second = partitionPlacements(placements, fewer).visible;
    expect(first).toEqual(placements);
    expect(second).toEqual(
      first.filter(
        p => p.widgetId !== "core/team" && p.widgetId !== "acme/orders"
      )
    );
  });

  it("names each card after its widget, so repeated reads are identical", () => {
    const p = plan({ cards: CORE_DEFAULT_LAYOUT });
    expect(defaultLayoutPlacements(core, p).map(each => each.id)).toEqual(
      CORE_DEFAULT_LAYOUT.map(card => card.widget)
    );
    expect(defaultLayoutPlacements(core, p)).toEqual(
      defaultLayoutPlacements(core, p)
    );
  });
});
