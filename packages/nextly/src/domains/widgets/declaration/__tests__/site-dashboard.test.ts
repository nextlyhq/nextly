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
import { CORE_DEFAULT_LAYOUT } from "../../core-widgets/ids";
import { defaultLayoutPlan } from "../../default-layout";
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
  it("starts, and says which keys it accepts but does not apply yet", () => {
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
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "site-dashboard-keys-not-applied",
        keys: ["hide", "overrides", "replace"],
      })
    );
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

  it("starts with a generated card's id it cannot see yet, still checking the config's own shape", () => {
    // 🔴 Generated cards are derived when the dashboard is first read, after
    // this check: refused as unknown, a valid config would not start.
    expect(() =>
      resetWidgetRegistries([shop], {
        hide: ["single/home-card"],
        overrides: {
          "collection/posts-count": { size: { default: { w: 6, h: 4 } } },
        },
        defaultLayout: [{ widget: "collection/posts-count", w: 6, h: 3 }],
      })
    ).not.toThrow();
    // Its shape is still checked: a key the entry does not take is refused,
    // so is a size the grid cannot draw, and so is placing a hidden
    // generated card.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: ["collection/pages-count"],
        overrides: {
          "collection/posts-count": {
            widht: "half",
            size: { default: { w: 13, h: 4 } },
          },
        },
        defaultLayout: [
          "collection/pages-count",
          { widget: "collection/posts-count", w: 0 },
        ],
      })
    );
    expect(message).toContain('overrides entry has "widht"');
    expect(message).toContain(
      'overrides.size.default must be { w, h } with w a whole number from 1 to 12 and h a whole number from 2 to 12, got {"w":13,"h":4}'
    );
    expect(message).toContain(
      'defaultLayout places "collection/pages-count", which hide hides'
    );
    expect(message).toContain(
      "defaultLayout w must be a whole number from 1 to 12, got 0"
    );
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
        defaultLayout: ["acme/recent-orders", "acme/recent-orders"],
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

  it("refuses a default with more cards than a dashboard holds", () => {
    expect(
      refusal(() =>
        resetWidgetRegistries([shop], {
          defaultLayout: Array.from(
            { length: 201 },
            () => "acme/recent-orders"
          ),
        })
      )
    ).toContain(
      "defaultLayout holds 201 cards, and a dashboard holds at most 200"
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
});

describe("startup's warnings", () => {
  it("go through the registration's logger, and never the process-wide one", () => {
    const registration = { warn: vi.fn() };
    resetWidgetRegistries([shop], { hide: ["core/team"] }, registration);
    expect(registration.warn).toHaveBeenCalledWith(
      "admin.dashboard.hide is accepted but not applied yet in this version.",
      { kind: "site-dashboard-keys-not-applied", keys: ["hide"] }
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
