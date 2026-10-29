/**
 * The site config's `admin.dashboard`, checked at startup against every widget
 * the install has, with every fault refused together with the widget
 * declarations' own, each naming "the site config" and the entry.
 *
 * Driven through `resetWidgetRegistries`, as both boot paths call it, with the
 * site config as plain JavaScript hands it over: unchecked by types, which
 * would refuse most of the faults these cases are about.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetWidgetRegistries } from "../../../../di/registrations/register-widgets";
import { NextlyError } from "../../../../errors/nextly-error";
import * as loggerModule from "../../../../observability/logger";
import type { PluginContributions } from "../../../../plugins/contributions";
import {
  definePlugin,
  type PluginDefinition,
} from "../../../../plugins/plugin-context";
import { allWidgets } from "../../canonical";
import { CORE_DEFAULT_LAYOUT } from "../../core-widgets/ids";
import {
  defaultLayoutPlacements,
  defaultLayoutPlan,
} from "../../default-layout";
import { siteDashboardRules } from "../../site-rules";
import { declaredWidget, resetLegacyIdWarnings } from "../declared-widgets";
import { siteDashboardContext } from "../site-dashboard";

import { dashboard, revenue } from "./plugin/widgets";

const shop = definePlugin({
  name: "@acme/shop",
  version: "1.0.0",
  nextly: "*",
  contributes: { dashboard },
});

/** A plugin's dashboard as plain JavaScript hands it over. */
function plainPlugin(name: string, contributed: unknown) {
  return definePlugin({
    name,
    version: "1.0.0",
    nextly: "*",
    contributes: {
      dashboard: contributed as PluginContributions["dashboard"],
    },
  });
}

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

const warn = vi.fn();

beforeEach(() => {
  resetLegacyIdWarnings();
  warn.mockReset();
  vi.spyOn(loggerModule, "getNextlyLogger").mockReturnValue({
    warn,
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as ReturnType<typeof loggerModule.getNextlyLogger>);
});

describe("a site config that names what exists", () => {
  it("starts, and applies what it hides, replaces and overrides, warning of none of them", () => {
    expect(() =>
      resetWidgetRegistries([shop], {
        hide: ["core/team"],
        overrides: {
          "core/recently-edited": {
            title: "Latest edits",
            description: "What changed most recently",
          },
          "acme/orders-by-state": {
            size: { default: { w: 4, h: 4 }, max: { w: 6, h: 5 } },
            settings: { top: 8 },
          },
        },
        defaultLayout: [
          "core/recently-edited",
          {
            widget: "acme/orders-by-state",
            w: 4,
            h: 3,
            settings: { top: 3 },
          },
        ],
        suggestions: false,
        replace: { "core/recently-edited": "acme/recent-orders" },
      })
    ).not.toThrow();
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "site-dashboard-keys-not-applied" })
    );
    // The rules every reading of a widget takes, from the copy checked.
    const rules = siteDashboardRules();
    expect([...rules.hidden]).toEqual(["core/team"]);
    expect([...rules.replaced]).toEqual([
      ["core/recently-edited", "acme/recent-orders"],
    ]);
    expect([...rules.alternatives]).toEqual(["acme/recent-orders"]);
    expect(rules.overrides.get("core/recently-edited")).toEqual({
      title: "Latest edits",
      description: "What changed most recently",
    });
    // The alternative takes the built-in's place, at its own starting size.
    expect(defaultLayoutPlan().cards[0]).toEqual({
      widget: "acme/recent-orders",
    });
  });

  it("checks the site's own widgets with the plugins', which the rest may name, and registers none yet", () => {
    resetWidgetRegistries([shop], {
      widgets: [{ ...revenue, id: "site/revenue" }],
      defaultLayout: [{ widget: "site/revenue", w: 12 }],
    });
    // Not kept until the admin's component map reads the site's widgets too,
    // and said so at startup.
    expect(declaredWidget("site/revenue")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "site-dashboard-keys-not-applied",
        keys: ["widgets"],
      })
    );
  });

  it("refuses an id in a retired per-collection namespace, naming it and what replaced it", () => {
    // 🔴 Core no longer makes a card per collection or per Single, so an id in
    // `collection/` or `single/` names nothing, wherever the config names it:
    // `hide`, `overrides` and `defaultLayout` alike.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: ["single/home-card"],
        overrides: {
          "collection/posts-count": { size: { default: { w: 6, h: 4 } } },
        },
        defaultLayout: [{ widget: "collection/posts-count", w: 6, h: 3 }],
      })
    );
    // The collection's card is told the widgets that replace it and the
    // collection to set them to, the slug its id was minted from.
    const told = `which is a retired card: core no longer makes a card per collection. Add Count, Breakdown, Over time or Recent entries and set its Collection to the collection this card showed.`;
    // A Single's card is never told to pick a collection: the widgets with a
    // Collection setting offer collections only.
    const toldSingle = `which is a retired card: core no longer makes a card per Single. A Single's edits show in Recently edited (core/recently-edited).`;
    expect(message).toContain(`hide names "single/home-card", ${toldSingle}`);
    expect(message).toContain(
      `overrides names "collection/posts-count", ${told}`
    );
    expect(message).toContain(
      `defaultLayout names "collection/posts-count", ${told}`
    );
    // The control: an unknown id outside those namespaces gets the ordinary
    // refusal, so the wording above is the namespace's and not every unknown
    // id's.
    expect(
      refusal(() => resetWidgetRegistries([shop], { hide: ["collections/x"] }))
    ).toContain('hide names "collections/x", which no widget declares');
  });

  it("refuses a retired id in defaultLayout even as an optional card", () => {
    // An optional card may name a widget the install lacks and is left out
    // without a word, but no install has a retired card: left out quietly, the
    // site would never be told what replaced it.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          { widget: "core/team" },
          { widget: "collection/posts-count", optional: true },
          { widget: "single/home-card", optional: true },
        ],
      })
    );
    expect(message).toContain(
      'defaultLayout names "collection/posts-count", which is a retired card'
    );
    expect(message).toContain(
      'defaultLayout names "single/home-card", which is a retired card'
    );
    // The control: an optional card naming any other absent widget is still
    // left out without a fault.
    expect(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          { widget: "core/team" },
          { widget: "acme/absent", optional: true },
        ],
      })
    ).not.toThrow();
  });

  it("says nothing when it sets no key", () => {
    resetWidgetRegistries([shop], {});
    expect(warn).not.toHaveBeenCalledWith(
      expect.objectContaining({ kind: "site-dashboard-keys-not-applied" })
    );
  });
});

describe("a site config with faults", () => {
  it("stops on every fault at once, with the declarations' own, naming each entry", () => {
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        widgets: [{ ...revenue, id: "site/revenue", title: "" }],
        hide: ["core/teem"],
        overrides: {
          "acme/orders-by-state": {
            description: "Orders by state\nand by region",
            size: { min: { w: 3, h: 3 } },
            settings: { top: "many", colour: "red" },
          },
        },
        defaultLayout: [{ widget: "acme/orders-by-state", w: 12 }],
        replace: { "core/recently-edited": "acme/revenue" },
      })
    );
    for (const expected of [
      'the site config, widget "site/revenue": title must be a non-empty string',
      'the site config, widget "core/teem": hide names "core/teem", which no widget declares; did you mean "core/team"?',
      'the site config, widget "acme/orders-by-state": overrides.description must be one line',
      'the site config, widget "acme/orders-by-state": overrides.size.min { w: 3, h: 3 } widens the smallest size; the widget allows from { w: 4, h: 3 } to { w: 8, h: 6 }, and an override may only narrow that',
      'the site config, widget "acme/orders-by-state": overrides.settings sets "colour", which the widget does not declare',
      'the site config, widget "acme/orders-by-state": overrides.settings: setting "top"',
      'the site config, widget "acme/orders-by-state": defaultLayout w is 12, which the widget does not allow (from 4 to 8)',
      'the site config, widget "core/recently-edited": replace puts "acme/revenue" in place of "core/recently-edited", and no plugin offers it as an alternative to "core/recently-edited"',
    ]) {
      expect(message).toContain(expected);
    }
    expect(message).toContain("8 widget declarations cannot work");
  });

  it("refuses a widget listed twice in the default when it allows one card, and keeps one that allows several", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: ["acme/orders-by-state", "acme/orders-by-state"],
        })
      )
    ).toContain(
      'the site config, widget "acme/orders-by-state": defaultLayout lists "acme/orders-by-state" more than once, and it allows one card'
    );
    expect(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          "acme/recent-orders",
          { widget: "acme/recent-orders", id: "recent-orders-2" },
        ],
      })
    ).not.toThrow();
  });

  it("refuses a default or a replacement that names a hidden widget", () => {
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: ["acme/recent-orders"],
        defaultLayout: ["acme/recent-orders"],
        replace: { "core/recently-edited": "acme/recent-orders" },
      })
    );
    expect(message).toContain(
      'defaultLayout places "acme/recent-orders", which hide hides'
    );
    expect(message).toContain(
      'replace puts "acme/recent-orders" in place of "core/recently-edited", and hide hides it'
    );
  });

  it("refuses a further card of one widget that names no id of its own, showing the entry to write", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: ["acme/recent-orders", "acme/recent-orders"],
        })
      )
    ).toContain(
      'the site config, widget "acme/recent-orders": defaultLayout places "acme/recent-orders" again (entry 2) with no id of its own: name the card, as { widget: "acme/recent-orders", id: "recent-orders-2" }'
    );
  });

  it("refuses a card id with no text in it, as a save would refuse it", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: [
            "acme/recent-orders",
            { widget: "acme/recent-orders", id: "   " },
          ],
        })
      )
    ).toContain('defaultLayout id must be a non-empty string, got "   "');
  });

  it("refuses two cards under one id, and a card named after a widget", () => {
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          { widget: "acme/recent-orders", id: "orders" },
          { widget: "acme/recent-orders", id: "orders" },
          { widget: "acme/recent-orders", id: "core/team" },
        ],
      })
    );
    expect(message).toContain(
      'defaultLayout names two cards "orders": each card needs an id of its own'
    );
    expect(message).toContain(
      'defaultLayout names a card "core/team", which is a widget\'s id; give it a name no widget has'
    );
  });

  it("refuses a default with more cards than a dashboard holds", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: Array.from({ length: 201 }, (_, index) => ({
            widget: "acme/recent-orders",
            id: `orders-${index}`,
          })),
        })
      )
    ).toContain(
      "defaultLayout places 201 cards, and a dashboard holds at most 200"
    );
  });

  it("counts against that room only the cards it places, never an optional one whose widget is absent", () => {
    const full = Array.from({ length: 200 }, (_, index) => ({
      widget: "acme/recent-orders",
      id: `orders-${index}`,
    }));
    expect(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          ...full,
          { widget: "other/not-installed", optional: true },
        ],
      })
    ).not.toThrow();
    // An optional card whose widget IS installed is placed, and counted.
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: [
            ...full,
            { widget: "acme/recent-orders", optional: true },
          ],
        })
      )
    ).toContain(
      "defaultLayout places 201 cards, and a dashboard holds at most 200"
    );
  });

  it("refuses a key it does not take, at each level, naming the one it most likely meant", () => {
    // 🔴 Accepted, a misspelt key does nothing, and nothing says so.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        defaultlayout: ["core/team"],
        overrides: {
          "core/team": { sise: {}, size: { Max: { w: 6, h: 4 } } },
        },
        defaultLayout: [{ widget: "core/team", W: 6 }],
      })
    );
    expect(message).toContain(
      'admin.dashboard has "defaultlayout", which it does not take; did you mean "defaultLayout"?'
    );
    expect(message).toContain(
      'overrides entry has "sise", which it does not take; did you mean "size"?'
    );
    expect(message).toContain(
      'overrides.size has "Max", which it does not take; did you mean "max"?'
    );
    expect(message).toContain(
      'defaultLayout card has "W", which it does not take; did you mean "w"?'
    );
  });

  it("names a hide entry it cannot print as text, with the other faults", () => {
    // A value String() would throw on is still named, not thrown on.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: [Object.create(null), "core/teem"],
      })
    );
    expect(message).toContain("hide must name a widget by its id");
    expect(message).toContain('hide names "core/teem"');
  });

  it("refuses a replacement keyed by a widget that is not built in", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          replace: { "acme/revenue": "acme/recent-orders" },
        })
      )
    ).toContain('replace names "acme/revenue", which is not a built-in widget');
  });
});

describe("a site config's sizes, in grid units", () => {
  // acme/orders-by-state allows from { w: 4, h: 3 } to { w: 8, h: 6 }.
  const site = (overrides: unknown, defaultLayout?: unknown) => () =>
    resetWidgetRegistries([shop], {
      overrides: { "acme/orders-by-state": overrides },
      ...(defaultLayout === undefined ? {} : { defaultLayout }),
    });

  it("checks a default card against the bounds the site's override narrows", () => {
    // 🔴 The override is applied where the card is judged: w 8 is one the
    // widget allows, and not one the site's narrowed bounds do.
    const card = { widget: "acme/orders-by-state", w: 8 };
    expect(site({ size: { default: { w: 6, h: 4 } } }, [card])).not.toThrow();
    expect(refusal(site({ size: { max: { w: 6, h: 6 } } }, [card]))).toContain(
      'widget "acme/orders-by-state": defaultLayout w is 8, which the widget does not allow (from 4 to 6)'
    );
  });

  it("checks each direction a default card states, against the grid and the widget", () => {
    const message = refusal(
      site({ title: "Orders" }, [
        { widget: "acme/orders-by-state", h: 7 },
        { widget: "acme/recent-orders", w: "half", h: 0 },
      ])
    );
    expect(message).toContain(
      'widget "acme/orders-by-state": defaultLayout h is 7, which the widget does not allow (from 3 to 6)'
    );
    // A named width is not a size: the grid's own units are the only ones.
    expect(message).toContain(
      'widget "acme/recent-orders": defaultLayout w must be a whole number from 1 to 12, got "half"'
    );
    expect(message).toContain(
      'widget "acme/recent-orders": defaultLayout h must be a whole number from 2 to 12, got 0'
    );
  });

  it("refuses an override that widens the widget's bounds at either end", () => {
    const message = refusal(
      site({ size: { min: { w: 4, h: 2 }, max: { w: 9, h: 6 } } })
    );
    expect(message).toContain(
      "overrides.size.min { w: 4, h: 2 } widens the smallest size; the widget allows from { w: 4, h: 3 } to { w: 8, h: 6 }"
    );
    expect(message).toContain(
      "overrides.size.max { w: 9, h: 6 } widens the largest size"
    );
  });

  it("refuses an override that leaves no size between its ends, or starts outside them", () => {
    expect(
      refusal(site({ size: { min: { w: 6, h: 4 }, max: { w: 5, h: 6 } } }))
    ).toContain(
      "overrides.size leaves no size between its smallest { w: 6, h: 4 } and its largest { w: 5, h: 6 }"
    );
    // Within the widget's bounds, and outside the site's own.
    expect(
      refusal(site({ size: { default: { w: 8, h: 4 }, max: { w: 6, h: 6 } } }))
    ).toContain(
      "overrides.size.default { w: 8, h: 4 } is not between the smallest size { w: 4, h: 3 } and the largest { w: 6, h: 6 }"
    );
  });

  it("refuses an override's size that is not one, and the named widths it once took", () => {
    const message = refusal(
      site({ width: "half", widths: ["half"], size: "half" })
    );
    expect(message).toContain('overrides entry has "width"');
    expect(message).toContain('overrides entry has "widths"');
    expect(message).toContain(
      "overrides.size must be { default?, min?, max? }, each { w, h }"
    );
  });
});

describe("a plugin's suggestions and alternatives", () => {
  it("reads a plugin's contribution once, so what it suggests is judged against what it registered", () => {
    // 🔴 A plain JavaScript plugin whose contribution answers differently on
    // each read: read twice, the second read's widgets would make the
    // suggestion look like its own.
    let reads = 0;
    const shifting = {
      name: "@shifty/stats",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        get dashboard() {
          reads += 1;
          return reads === 1
            ? {
                widgets: [{ ...revenue, id: "shifty/a" }],
                suggest: ["shifty/b"],
              }
            : {
                widgets: [{ ...revenue, id: "shifty/b" }],
                suggest: ["shifty/b"],
              };
        },
      },
    } as unknown as PluginDefinition;
    const message = refusal(() => resetWidgetRegistries([shifting]));
    expect(message).toContain(
      'plugin "@shifty/stats", widget "shifty/b": suggests "shifty/b", which is not one of its own widgets'
    );
    expect(reads).toBe(1);
  });

  it("refuses a key a plugin's dashboard contribution does not take, naming the one it most likely meant", () => {
    // 🔴 Dropped, a misspelt `suggest` would never place anything, and
    // nothing would say so.
    const message = refusal(() =>
      resetWidgetRegistries([
        plainPlugin("@other/stats", {
          widgets: [{ ...revenue, id: "other/revenue" }],
          sugest: ["other/revenue"],
        }),
      ])
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "(contributes.dashboard)": contributes.dashboard has "sugest", which it does not take; did you mean "suggest"?'
    );
  });

  it("names an alternative's built-in it cannot print as JSON, with the other faults", () => {
    // A value JSON cannot print is still named, not thrown on.
    const message = refusal(() =>
      resetWidgetRegistries([
        plainPlugin("@other/stats", {
          widgets: [{ ...revenue, id: "other/revenue" }],
          alternatives: { "other/revenue": 1n },
        }),
      ])
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "other/revenue": offers "other/revenue" in place of'
    );
    expect(message).toContain("which is not a built-in widget");
  });

  it("refuses one that names a widget not its own, or a built-in that does not exist", () => {
    const message = refusal(() =>
      resetWidgetRegistries([
        shop,
        plainPlugin("@other/stats", {
          widgets: [{ ...revenue, id: "other/revenue" }],
          suggest: ["acme/revenue"],
          alternatives: {
            "acme/recent-orders": "core/recently-edited",
            "other/revenue": "core/nothing",
          },
        }),
      ])
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "acme/revenue": suggests "acme/revenue", which is not one of its own widgets'
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "acme/recent-orders": offers "acme/recent-orders" as an alternative, which is not one of its own widgets'
    );
    expect(message).toContain(
      'plugin "@other/stats", widget "other/revenue": offers "other/revenue" in place of "core/nothing", which is not a built-in widget'
    );
  });
});

describe("the default the site config asks for", () => {
  it("checks a reload's config against the widgets as declared, not the last boot's overrides", () => {
    // An older-shape widget, whose facts the check reads from the widget list
    // the site's overrides apply to (a declared one is read from its declaration).
    const reports = definePlugin({
      name: "@acme/reports",
      version: "1.0.0",
      nextly: "*",
      contributes: {
        admin: {
          widgets: [
            {
              id: "acme/reports",
              component: "@acme/reports/admin#Reports",
              size: { default: { w: 6, h: 3 }, max: { w: 12, h: 6 } },
            },
          ],
        },
      },
    } as unknown as Parameters<typeof definePlugin>[0]);
    // The first boot narrows it to half the width.
    resetWidgetRegistries([reports], {
      overrides: { "acme/reports": { size: { max: { w: 6, h: 6 } } } },
    });
    // The second drops that override and places it at full width, which the
    // widget as declared allows.
    expect(() =>
      resetWidgetRegistries([reports], {
        defaultLayout: [{ widget: "acme/reports", w: 12 }],
      })
    ).not.toThrow();
  });

  it("keeps each replaced card's own id, place and size, and drops only the built-in's settings", () => {
    const notes = plainPlugin("@acme/notes", {
      widgets: [{ ...revenue, id: "acme/notes", several: true }],
      alternatives: { "acme/notes": "core/note" },
    });
    resetWidgetRegistries([notes], {
      defaultLayout: [
        "core/team",
        { widget: "core/note", id: "note-a", w: 4, settings: { text: "a" } },
        { widget: "core/note", id: "note-b", w: 8 },
      ],
      replace: { "core/note": "acme/notes" },
    });
    expect(defaultLayoutPlan().cards).toEqual([
      { widget: "core/team" },
      { widget: "acme/notes", id: "note-a", w: 4 },
      { widget: "acme/notes", id: "note-b", w: 8 },
    ]);
    // Two cards, two identities, each held within the alternative's bounds
    // (it is at least 6 wide): a save carries both back.
    const placed = defaultLayoutPlacements(allWidgets()).filter(
      placement => placement.widgetId === "acme/notes"
    );
    expect(placed.map(p => [p.id, p.w, p.config])).toEqual([
      ["note-a", 6, undefined],
      ["note-b", 8, undefined],
    ]);
  });

  it("is set at startup from the copy checked: its defaultLayout, suggestions off, and what plugins suggest", () => {
    resetWidgetRegistries([shop], {
      defaultLayout: [
        "core/team",
        { widget: "acme/orders-by-state", w: 4, settings: { top: 3 } },
      ],
      suggestions: false,
    });
    expect(defaultLayoutPlan()).toEqual({
      cards: [
        { widget: "core/team" },
        { widget: "acme/orders-by-state", w: 4, settings: { top: 3 } },
      ],
      suggestions: false,
      suggested: ["acme/orders-by-state"],
    });
  });

  it("is core's own defaultLayout, with suggestions on, when the site gives none", () => {
    resetWidgetRegistries([shop], {});
    expect(defaultLayoutPlan()).toEqual({
      cards: CORE_DEFAULT_LAYOUT,
      suggestions: true,
      suggested: ["acme/orders-by-state"],
    });
  });

  it("starts, saying nothing, with an optional card whose widget is not installed", () => {
    resetWidgetRegistries([], {
      defaultLayout: [
        { widget: "acme/orders-by-state", optional: true },
        "core/team",
      ],
    });
    expect(warn).not.toHaveBeenCalled();
    expect(defaultLayoutPlan().cards).toEqual([
      { widget: "acme/orders-by-state", optional: true },
      { widget: "core/team" },
    ]);
  });

  it("refuses a card not marked optional whose widget is not installed, and an optional that is not true or false", () => {
    const message = refusal(() =>
      resetWidgetRegistries([], {
        defaultLayout: [
          { widget: "acme/orders-by-state" },
          { widget: "core/team", optional: "yes" },
        ],
      })
    );
    expect(message).toContain(
      'the site config, widget "acme/orders-by-state": defaultLayout names "acme/orders-by-state", which no widget declares'
    );
    expect(message).toContain(
      'the site config, widget "core/team": defaultLayout optional must be true or false, got "yes"'
    );
  });

  it("still checks an optional card's size when its widget is installed", () => {
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        defaultLayout: [
          { widget: "acme/orders-by-state", optional: true, w: 12 },
        ],
      })
    );
    expect(message).toContain(
      'the site config, widget "acme/orders-by-state": defaultLayout w is 12, which the widget does not allow (from 4 to 8)'
    );
  });
});

describe("a list with an empty slot", () => {
  // `[a, , b]`: every reading of the list skips the hole, so an entry lost to
  // a stray comma would vanish without a word.
  /** A list of `length` with `entries` at their places and a hole at every other. */
  const holed = (length: number, entries: Record<number, unknown>) => {
    const list = new Array<unknown>(length);
    for (const [index, entry] of Object.entries(entries)) {
      list[Number(index)] = entry;
    }
    return list;
  };

  it("is refused in each list of the site config, naming the list", () => {
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: holed(3, { 0: "core/team", 2: "core/content" }),
        defaultLayout: holed(3, { 0: "core/content", 2: "core/team" }),
        widgets: holed(2, { 0: { ...revenue, id: "site/revenue" } }),
      })
    );
    for (const expected of [
      'the site config, widget "(hide)": hide has an empty slot at position 2; remove the extra comma',
      'the site config, widget "(defaultLayout)": defaultLayout has an empty slot at position 2; remove the extra comma',
      'the site config, widget "(widgets)": widgets has an empty slot at position 2; remove the extra comma',
    ]) {
      expect(message).toContain(expected);
    }
  });

  it("is refused in each list of a plugin's contribution, naming the list", () => {
    const message = refusal(() =>
      resetWidgetRegistries([
        plainPlugin("@other/stats", {
          widgets: holed(2, { 1: { ...revenue, id: "other/revenue" } }),
          suggest: holed(3, { 0: "other/revenue", 2: "other/revenue" }),
        }),
      ])
    );
    for (const expected of [
      'plugin "@other/stats", widget "(widgets)": widgets has an empty slot at position 1',
      'plugin "@other/stats", widget "(suggest)": suggest has an empty slot at position 2',
    ]) {
      expect(message).toContain(expected);
    }
  });
});

describe("a plugin that adds only Needs attention items", () => {
  it("starts with no widgets declared, reading none as declaring none", () => {
    expect(() =>
      resetWidgetRegistries([
        plainPlugin("@other/inbox", { attention: dashboard.attention }),
      ])
    ).not.toThrow();
  });

  it("is refused when its widgets are null, which is a list that is not one, not none", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([plainPlugin("@other/inbox", { widgets: null })])
      )
    ).toContain(
      'plugin "@other/inbox", widget "(none)": its dashboard widgets must be a list of widget declarations'
    );
  });
});

describe("startup's warnings", () => {
  it("go through the registration's logger, and never the process-wide one", () => {
    const registration = { warn: vi.fn() };
    resetWidgetRegistries(
      [shop],
      { widgets: [{ ...revenue, id: "site/revenue" }] },
      registration
    );
    expect(registration.warn).toHaveBeenCalledWith(
      "admin.dashboard.widgets is accepted but not applied yet in this version.",
      { kind: "site-dashboard-keys-not-applied", keys: ["widgets"] }
    );
    expect(warn).not.toHaveBeenCalled();
  });
});

describe("core's ids", () => {
  it("are the one set registration derives, handed to the site config's check", () => {
    const coreIds = new Set(["core/team"]);
    expect(siteDashboardContext(new Map(), new Map(), coreIds).coreIds).toBe(
      coreIds
    );
  });
});
