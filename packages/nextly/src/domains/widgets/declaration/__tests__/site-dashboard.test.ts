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
import { declaredWidget, resetLegacyIdWarnings } from "../declared-widgets";

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
            width: "half",
            widths: ["half", "full"],
          },
          "acme/orders-by-state": { settings: { top: 8 } },
        },
        defaultLayout: [
          "core/recently-edited",
          {
            widget: "acme/orders-by-state",
            width: "third",
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
        keys: ["hide", "overrides", "defaultLayout", "suggestions", "replace"],
      })
    );
  });

  it("checks the site's own widgets with the plugins', which the rest may name, and registers none yet", () => {
    resetWidgetRegistries([shop], {
      widgets: [{ ...revenue, id: "site/revenue" }],
      defaultLayout: [{ widget: "site/revenue", width: "full" }],
    });
    // Not kept until the admin's component map reads the site's widgets too,
    // and said so at startup.
    expect(declaredWidget("site/revenue")).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "site-dashboard-keys-not-applied",
        keys: ["widgets", "defaultLayout"],
      })
    );
  });

  it("starts with a generated card's id it cannot see yet, still checking the config's own shape", () => {
    // 🔴 Generated cards are derived when the dashboard is first read, after
    // this check: refused as unknown, a valid config would not start.
    expect(() =>
      resetWidgetRegistries([shop], {
        hide: ["single/home-card"],
        overrides: { "collection/posts-count": { width: "half" } },
        defaultLayout: ["collection/posts-count"],
      })
    ).not.toThrow();
    // Its shape is still checked: a key the entry does not take is refused,
    // and so is placing a hidden generated card.
    const message = refusal(() =>
      resetWidgetRegistries([shop], {
        hide: ["collection/pages-count"],
        overrides: { "collection/posts-count": { widht: "half" } },
        defaultLayout: ["collection/pages-count"],
      })
    );
    expect(message).toContain('overrides entry has "widht"');
    expect(message).toContain(
      'defaultLayout places "collection/pages-count", which hide hides'
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
          "core/recently-edited": { widths: ["quarter", "half"] },
          "acme/orders-by-state": {
            description: "x".repeat(81),
            settings: { top: "many", colour: "red" },
          },
        },
        defaultLayout: [{ widget: "acme/orders-by-state", width: "full" }],
        replace: { "core/recently-edited": "acme/revenue" },
      })
    );
    for (const expected of [
      'the site config, widget "site/revenue": title must be a non-empty string',
      'the site config, widget "core/teem": hide names "core/teem", which no widget declares; did you mean "core/team"?',
      'the site config, widget "core/recently-edited": overrides.widths adds "quarter", which the widget does not allow; widths may only be narrowed',
      'the site config, widget "acme/orders-by-state": overrides.description must be at most 80 characters, has 81',
      'the site config, widget "acme/orders-by-state": overrides.settings sets "colour", which the widget does not declare',
      'the site config, widget "acme/orders-by-state": overrides.settings: setting "top"',
      'the site config, widget "acme/orders-by-state": defaultLayout width is "full", which the widget does not allow',
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
        overrides: { "core/team": { widht: "half" } },
        defaultLayout: [{ widget: "core/team", widths: ["half"] }],
      })
    );
    expect(message).toContain(
      'admin.dashboard has "defaultlayout", which it does not take; did you mean "defaultLayout"?'
    );
    expect(message).toContain(
      'overrides entry has "widht", which it does not take; did you mean "width"?'
    );
    expect(message).toContain(
      'defaultLayout card has "widths", which it does not take; did you mean "width"?'
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
