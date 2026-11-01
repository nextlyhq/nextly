/**
 * One answer to "which widgets exist": every published widget, as layout
 * resolution reads it.
 */
import { beforeEach, describe, expect, it } from "vitest";

import { allWidgets, sizeFacts, type CanonicalWidget } from "../canonical";
import {
  collectionWidgets,
  unreadableCollectionCard,
} from "../collection-cards";
import {
  clearDeclaredWidgets,
  registerDashboardWidgets,
} from "../declaration/declared-widgets";
import { defineWidget } from "../declaration/define-widget";
import type { WidgetDefinition } from "../definition";
import { sizeBounds } from "../grid-size";
import { clearWidgets, registerWidget } from "../registry";
import { setSiteDashboardRules } from "../site-rules";
import { UNSTATED_WIDGET_SIZE } from "../unstated-size";

function registered(patch: Partial<WidgetDefinition>): WidgetDefinition {
  const definition = {
    id: "core/a",
    title: "A",
    archetype: "custom",
    size: { default: { w: 12, h: 4 } },
    component: "core#A",
    ...patch,
  };
  // A key set to `undefined` is one JSON drops, and a registration carrying
  // one is not one the admin may receive -- so a patch that unsets the base
  // fixture's `component` removes the key rather than voiding it.
  return withoutUndefined(definition) as WidgetDefinition;
}

/** `value` less every key set to `undefined`. */
function withoutUndefined<T extends object>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined)
  ) as Partial<T>;
}

beforeEach(() => {
  clearWidgets();
  clearDeclaredWidgets();
});

describe("the canonical widget set", () => {
  it("has no entry at all for a registration the admin cannot receive", () => {
    // A card the grid can never draw is not one the layout may place: a
    // registration JSON cannot carry never reaches the browser.
    registerWidget(
      registered({
        id: "core/heavy",
        archetype: "metric",
        component: undefined,
        query: {
          source: "collection:posts",
          op: "count",
          where: { views: { greater_than: 10n } },
        },
      } as Partial<WidgetDefinition>)
    );
    registerWidget(registered({ id: "core/light" }));
    expect(allWidgets().map(widget => widget.id)).toEqual(["core/light"]);
  });

  it("carries the fields placement reads", () => {
    registerWidget(
      registered({
        id: "core/team",
        requiredPermission: "read-users",
        size: { default: { w: 4, h: 4 }, max: { w: 6, h: 4 } },
        defaultOrder: 20,
      })
    );
    expect(allWidgets()[0]).toEqual({
      id: "core/team",
      requiredPermission: "read-users",
      size: { default: { w: 4, h: 4 }, max: { w: 6, h: 4 } },
      defaultOrder: 20,
      // As the registration states it: the add panel draws its sketch from it.
      archetype: "custom",
      // Always stated, as the empty list for a widget with no actions: the
      // reader gate flattens it, and an absent list would be a second way to
      // spell "no gates" beside the empty one.
      actionGates: [],
    });
  });

  it("carries the gate of every action, verbatim", () => {
    // 🔴 An `actions` widget's shortcuts each carry a gate of their own, and
    // the workspace payload withholds a shortcut on it before the declaration
    // ships: verbatim, including the absent ones, so the count matches the
    // actions.
    registerWidget(
      registered({
        id: "acme/links",
        archetype: "actions",
        component: undefined,
        actions: [
          { label: "Open", href: "/open" },
          { label: "Purge", href: "/purge", requiredPermission: "purge-notes" },
        ],
      })
    );
    expect(allWidgets()[0]?.actionGates).toEqual([undefined, "purge-notes"]);
  });

  it("omits what a declaration did not state", () => {
    registerWidget(registered({ id: "core/team" }));
    const [widget] = allWidgets();
    expect(widget).not.toHaveProperty("requiredPermission");
    expect(widget).not.toHaveProperty("defaultOrder");
    expect(widget).not.toHaveProperty("plugin");
  });

  it("names the plugin that declared a widget, which the add panel lists it under", () => {
    registerDashboardWidgets({
      groups: [
        {
          owner: 'plugin "@acme/forms"',
          plugin: "@acme/forms",
          declarations: [
            defineWidget({
              id: "forms/latest",
              title: "Latest",
              description: "The newest submissions.",
              size: { default: { w: 6, h: 4 } },
              load: () => Promise.resolve({ items: [] }),
              view: { component: "@acme/forms/admin#Latest" },
              isEmpty: () => false,
            }),
          ],
        },
      ],
    });
    // The control: core's registration names no plugin.
    registerWidget(registered({ id: "core/team" }));
    const byId = new Map(allWidgets().map(widget => [widget.id, widget]));
    expect(byId.get("forms/latest")?.plugin).toBe("@acme/forms");
    expect(byId.get("core/team")).not.toHaveProperty("plugin");
  });

  it("is empty when nothing is declared", () => {
    expect(allWidgets()).toEqual([]);
  });
});

describe("a widget the site config overrides", () => {
  it("withholds a card whose Collection setting the override starts at a collection the reader may not read", () => {
    setSiteDashboardRules({
      hidden: new Set(),
      replaced: new Map(),
      alternatives: new Set(),
      overrides: new Map([["acme/pinned", { settings: { source: "secret" } }]]),
    });
    try {
      // The canonical summary's own copy of the setting is the one
      // withholding and the token read.
      registerWidget(
        registered({
          id: "acme/pinned",
          archetype: "metric",
          component: undefined,
          query: { source: "collection:posts", op: "count" },
          settings: [
            {
              name: "source",
              type: "collection",
              label: "Collection",
              defaultValue: "posts",
            },
          ],
        })
      );
      const listed = allWidgets();
      const withheld = unreadableCollectionCard(
        collectionWidgets(listed),
        new Set(["posts"])
      );
      // A card that stores no value reads the starting value, now "secret".
      expect(
        withheld({
          id: "c",
          widgetId: "acme/pinned",
          w: 3,
          h: 2,
          removed: false,
        })
      ).toBe(true);
    } finally {
      setSiteDashboardRules({
        hidden: new Set(),
        replaced: new Map(),
        alternatives: new Set(),
        overrides: new Map(),
      });
    }
  });

  it("is listed as the override changes it", () => {
    setSiteDashboardRules({
      hidden: new Set(),
      replaced: new Map(),
      alternatives: new Set(),
      overrides: new Map([
        ["acme/stats", { description: "Ours", size: { max: { w: 6, h: 3 } } }],
      ]),
    });
    try {
      registerWidget(
        registered({
          id: "acme/stats",
          description: "Theirs",
          size: { default: { w: 4, h: 3 }, max: { w: 12, h: 6 } },
        })
      );
      const [stats] = allWidgets();
      expect(stats.description).toBe("Ours");
      expect(stats.size).toEqual({
        default: { w: 4, h: 3 },
        min: { w: 4, h: 3 },
        max: { w: 6, h: 3 },
      });
    } finally {
      setSiteDashboardRules({
        hidden: new Set(),
        replaced: new Map(),
        alternatives: new Set(),
        overrides: new Map(),
      });
    }
  });
});

describe("a widget's size", () => {
  it("is the declared size with every end filled in", () => {
    expect(
      sizeFacts({
        id: "w/a",
        size: {
          default: { w: 6, h: 4 },
          min: { w: 4, h: 3 },
          max: { w: 8, h: 6 },
        },
      })
    ).toEqual({
      size: {
        default: { w: 6, h: 4 },
        min: { w: 4, h: 3 },
        max: { w: 8, h: 6 },
      },
      allowsSeveral: false,
    });
  });

  it("fills an unstated minimum with the default and an unstated maximum with the full row at its height", () => {
    expect(
      sizeFacts({ id: "w/a", size: { default: { w: 4, h: 3 } } }).size
    ).toEqual({
      default: { w: 4, h: 3 },
      min: { w: 4, h: 3 },
      max: { w: 12, h: 3 },
    });
  });

  it("reads a widget that states no size as the unstated size, as the admin does", () => {
    // 🔴 One answer for a summary with no size: the same constant the
    // admin reads through `nextly/config`, so the server's default placement
    // and the grid cannot start the card at two sizes.
    expect(sizeFacts({ id: "w/a" }).size).toEqual(
      sizeBounds(UNSTATED_WIDGET_SIZE)
    );
  });

  it("carries a registration's size into the canonical summary", () => {
    const size = { default: { w: 6, h: 4 }, min: { w: 4, h: 3 } };
    registerWidget(registered({ id: "core/a", size }));
    const [summary] = allWidgets();
    expect(summary?.size).toEqual(size);
    expect(sizeFacts(summary as CanonicalWidget).size.min).toEqual({
      w: 4,
      h: 3,
    });
  });
});

describe("a widget offered per collection", () => {
  const perCollection = {
    id: "core/count",
    offered: "per-collection" as const,
  };

  it("allows several cards, one per collection, unless it says otherwise", () => {
    expect(sizeFacts(perCollection).allowsSeveral).toBe(true);
    expect(sizeFacts({ id: "core/team" }).allowsSeveral).toBe(false);
    expect(
      sizeFacts({ ...perCollection, allowsSeveral: false }).allowsSeveral
    ).toBe(false);
  });
});
