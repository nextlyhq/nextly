/**
 * The one default dashboard, built from one `defaultLayout` whoever wrote it:
 * core's own or the site's, its entries at their sizes and settings, an
 * optional entry left out where its widget is absent, and nothing after it:
 * no widget is placed that it does not name. Varied per person only by the
 * cards each may not see.
 */
import { describe, expect, it } from "vitest";

import type { CanonicalWidget } from "../canonical";
import { CORE_DEFAULT_LAYOUT, CORE_WIDGET_IDS } from "../core-widgets/ids";
import {
  defaultLayoutPlacements,
  pairHasItsOwnRow,
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
  ...patch,
});

const ids = (widgets: readonly CanonicalWidget[], p: DefaultLayoutPlan) =>
  defaultLayoutPlacements(widgets, p).map(placement => placement.widgetId);

/**
 * Core's own widgets, every one of them and nothing else, each at the starting size the case
 * gives none: an install without the form-builder plugin.
 */
const core = CORE_WIDGET_IDS.map(id => widget(id));

/** The one widget core's default names that is not core's own. */
const FORM_SUBMISSIONS = "form-builder/new-submissions";

describe("the base of the default", () => {
  it("is core's own defaultLayout, in its order, each card at its entry's size, the form submissions card left out without its plugin", () => {
    const placements = defaultLayoutPlacements(
      [...core].reverse(),
      plan({ cards: CORE_DEFAULT_LAYOUT })
    );
    expect(placements.map(p => [p.widgetId, `${p.w}x${p.h}`])).toEqual([
      ["core/setup", "12x2"],
      ["core/needs-attention", "8x4"],
      ["core/upcoming-releases", "4x4"],
      ["core/continue", "6x4"],
      ["core/content-table", "6x4"],
      ["core/team-activity", "6x4"],
    ]);
    // Each at its entry's size, not the widget's starting size (6x3 in this case).
    expect(placements[0]).toEqual({
      id: "core/setup",
      widgetId: "core/setup",
      w: 12,
      h: 2,
      removed: false,
    });
  });

  it("places the form submissions card in its place where the plugin provides it", () => {
    const placements = defaultLayoutPlacements(
      [...core, widget(FORM_SUBMISSIONS)],
      plan({ cards: CORE_DEFAULT_LAYOUT })
    );
    expect(placements.map(p => [p.widgetId, `${p.w}x${p.h}`])).toEqual([
      ["core/setup", "12x2"],
      ["core/needs-attention", "8x4"],
      ["core/upcoming-releases", "4x4"],
      ["core/continue", "6x4"],
      ["core/content-table", "6x4"],
      [FORM_SUBMISSIONS, "6x4"],
      ["core/team-activity", "6x4"],
    ]);
  });

  it("is the site's defaultLayout in place of core's whole, at its sizes and with its settings", () => {
    const placements = defaultLayoutPlacements(
      [...core, widget("acme/orders")],
      plan({
        cards: [
          { widget: "acme/orders", w: 4, settings: { top: 5 } },
          { widget: "core/upcoming-releases", h: 4 },
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
      {
        id: "core/upcoming-releases",
        widgetId: "core/upcoming-releases",
        w: 6,
        h: 4,
        removed: false,
      },
    ]);
  });

  it("leaves out an optional entry whose widget is not installed, and places it once it is", () => {
    const cards = [
      { widget: "acme/orders", optional: true },
      { widget: "core/upcoming-releases" },
    ];
    expect(ids(core, plan({ cards }))).toEqual(["core/upcoming-releases"]);
    expect(ids([...core, widget("acme/orders")], plan({ cards }))).toEqual([
      "acme/orders",
      "core/upcoming-releases",
    ]);
  });
});

describe("what follows the default's own cards", () => {
  const cards = [{ widget: "core/upcoming-releases" }];

  it("is nothing: no widget is placed that the default does not name", () => {
    // 🔴 Whatever kind it is: a plugin's declared widget (whose `suggest` places nothing), one
    // written as a plain definition with an order of its own, and one offered per collection.
    // The add panel offers each of them; only the default's entries are placed.
    const widgets = [
      ...core,
      widget("acme/revenue"),
      widget("old/early", { defaultOrder: 5 }),
      widget("old/none"),
      widget("acme/per-collection", { offered: "per-collection" }),
    ];
    expect(ids(widgets, plan({ cards }))).toEqual(["core/upcoming-releases"]);
    // The control: the same widgets are placed, in the default's order, once it names them.
    expect(
      ids(
        widgets,
        plan({
          cards: [{ widget: "old/none" }, ...cards, { widget: "acme/revenue" }],
        })
      )
    ).toEqual(["old/none", "core/upcoming-releases", "acme/revenue"]);
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
    // The second person may not see the releases or the plugin's widget.
    const fewer = new Set(
      [...everything].filter(
        id => id !== "core/upcoming-releases" && id !== "acme/orders"
      )
    );
    const first = partitionPlacements(placements, everything).visible;
    const second = partitionPlacements(placements, fewer).visible;
    expect(first).toEqual(placements);
    expect(second).toEqual(
      first.filter(
        p =>
          p.widgetId !== "core/upcoming-releases" &&
          p.widgetId !== "acme/orders"
      )
    );
  });

  it("names each card after its widget, so repeated reads are identical", () => {
    const p = plan({ cards: CORE_DEFAULT_LAYOUT });
    expect(
      defaultLayoutPlacements(core, p).map(each => [each.id, each.widgetId])
    ).toEqual(
      CORE_DEFAULT_LAYOUT.filter(card => card.widget !== FORM_SUBMISSIONS).map(
        card => [card.widget, card.widget]
      )
    );
    expect(defaultLayoutPlacements(core, p)).toEqual(
      defaultLayoutPlacements(core, p)
    );
  });

  it("keeps each card under the id its entry names, a card that names none under its widget's", () => {
    const p = plan({
      cards: [
        { widget: "site/many" },
        { widget: "site/one" },
        { widget: "site/many", id: "pages-count" },
        { widget: "site/many", id: "posts-count" },
      ],
    });
    const widgets = [widget("site/many"), widget("site/one")];
    expect(defaultLayoutPlacements(widgets, p).map(each => each.id)).toEqual([
      "site/many",
      "site/one",
      "pages-count",
      "posts-count",
    ]);
    // Named, never derived from a position: a card left out changes no other.
    const withoutFirst = plan({ cards: p.cards.slice(1) });
    expect(
      defaultLayoutPlacements(widgets, withoutFirst).map(each => each.id)
    ).toEqual(["site/one", "pages-count", "posts-count"]);
  });
});

describe("whether the default gives Needs attention and Upcoming releases a row of their own", () => {
  const NA = "core/needs-attention";
  const UR = "core/upcoming-releases";
  const card = (widgetId: string, w: number, h = 4) => ({ widgetId, w, h });

  it("is yes for core's own default, the two side by side after the setup row", () => {
    const placements = defaultLayoutPlacements(
      [...core, widget(FORM_SUBMISSIONS)],
      plan({ cards: CORE_DEFAULT_LAYOUT })
    );
    expect(pairHasItsOwnRow(placements)).toBe(true);
    // In either order, wherever the row falls.
    expect(
      pairHasItsOwnRow([
        card("site/a", 6),
        card("site/b", 6),
        card(UR, 4),
        card(NA, 8),
      ])
    ).toBe(true);
  });

  it("is no for a site's default that puts Needs attention beside a card of its own", () => {
    // Needs attention four wide beside an eight-wide card, and no Upcoming releases at all.
    expect(pairHasItsOwnRow([card(NA, 4), card("site/orders", 8)])).toBe(false);
  });

  it("is no where the two share a row with another card, or do not fill it", () => {
    expect(
      pairHasItsOwnRow([card("site/a", 4), card(NA, 4), card(UR, 4)])
    ).toBe(false);
    expect(pairHasItsOwnRow([card(NA, 4), card(UR, 4)])).toBe(false);
  });

  it("is no where the two are not next to each other", () => {
    expect(
      pairHasItsOwnRow([card(NA, 8), card("site/a", 4), card(UR, 4)])
    ).toBe(false);
  });

  it("is no past a row of mixed heights, which the grid may not lay out as rows of twelve", () => {
    // A tall four-wide card beside a short eight-wide one: the grid may place the next card in
    // the space under the short one, so the pair's row is not one this reading can stand by.
    expect(
      pairHasItsOwnRow([
        card("site/tall", 4, 8),
        card("site/short", 8, 4),
        card(NA, 8, 4),
        card(UR, 4, 4),
      ])
    ).toBe(false);
    // The control: the same cards with the first row tiled is yes.
    expect(
      pairHasItsOwnRow([
        card("site/tall", 4, 4),
        card("site/short", 8, 4),
        card(NA, 8, 4),
        card(UR, 4, 4),
      ])
    ).toBe(true);
  });

  it("is no where the pair's own row is of two heights", () => {
    expect(pairHasItsOwnRow([card(NA, 8, 4), card(UR, 4, 3)])).toBe(false);
  });

  it("is no where the first of them does not start a row", () => {
    // Laid out as the grid lays them: the four-wide card leaves eight on its row, where the
    // eight-wide Needs attention fits, so Upcoming releases wraps to the next row alone.
    expect(
      pairHasItsOwnRow([card("site/a", 4), card(NA, 8), card(UR, 4)])
    ).toBe(false);
  });
});
