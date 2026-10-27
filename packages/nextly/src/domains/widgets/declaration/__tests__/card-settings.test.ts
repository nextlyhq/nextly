/**
 * A card's settings, as the person left them, are what its `load` is handed;
 * where a stored value is missing, no longer fits, or is hidden by the setting
 * it depends on, the starting value is handed instead. A setting with no value
 * at all keeps `load` from running, and is named.
 *
 * The declaration is built with `defineWidget` and the real builders, so the
 * settings it holds are exactly what a plugin's would be.
 */
import { describe, expect, it } from "vitest";

import { resolveCardSettings, unsetSetting } from "../card-settings";
import { defineWidget } from "../define-widget";
import { settings } from "../setting-builders";

const recentEntries = defineWidget({
  id: "test/recent-entries",
  title: "Recent entries",
  description: "The newest entries of one collection",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: {
    collection: settings.collection(),
    sort: settings.sort({ of: "collection", default: "-updatedAt" }),
    range: settings.dateRange({ default: "30d" }),
    items: settings.items({ default: 5 }),
  },
  load: async ({ settings, services, signal }) => ({
    items: (
      await services.find(settings.collection, {
        select: ["title"],
        sort: settings.sort,
        where: { createdAt: { after: settings.range } },
        limit: settings.items,
        signal,
      })
    ).items,
  }),
  view: "list",
});

describe("a setting with no value", () => {
  it("is named, so the card asks for it rather than running load", () => {
    // A Collection setting has no default: it is given its value when a card is
    // placed from a collection's group. Until then the card cannot be loaded.
    // The builder states no label, so it is named by its key, as the card's
    // settings sheet names it.
    const stored = resolveCardSettings(recentEntries.settings, undefined);
    expect(unsetSetting(recentEntries.settings, stored)).toEqual({
      name: "collection",
      label: "collection",
    });
  });

  it("is named by its label where it states one", () => {
    const labelled = { range: { type: "select", label: "Date range" } };
    expect(unsetSetting(labelled, {})).toEqual({
      name: "range",
      label: "Date range",
    });
  });

  it("is none once every setting has a value", () => {
    const stored = resolveCardSettings(recentEntries.settings, {
      collection: "posts",
    });
    expect(unsetSetting(recentEntries.settings, stored)).toBeUndefined();
  });

  it("is named by its key where it states no label", () => {
    const unlabelled = { topic: { type: "text" } };
    expect(unsetSetting(unlabelled, {})).toEqual({
      name: "topic",
      label: "topic",
    });
  });
});

describe("the values a card is handed", () => {
  const STARTING = { sort: "-updatedAt", range: "30d", items: 5 };

  it("are the starting values where nothing is stored", () => {
    expect({
      ...resolveCardSettings(recentEntries.settings, undefined),
    }).toEqual(STARTING);
  });

  it("take the starting value for a stored value that no longer fits", () => {
    // A range the select does not offer, and a count outside 1 to 25: values a
    // person could have stored before the widget changed, or that someone wrote
    // by hand. Neither reaches the query.
    expect({
      ...resolveCardSettings(recentEntries.settings, {
        collection: "posts",
        range: "1y",
        items: 400,
      }),
    }).toEqual({ ...STARTING, collection: "posts" });
  });

  it("take the starting value for a setting hidden by the one it depends on", () => {
    // Sort depends on Collection. With no collection chosen there is nothing to
    // sort, so the stored sort is not handed on; its starting value is.
    expect(
      resolveCardSettings(recentEntries.settings, { sort: "title" }).sort
    ).toBe("-updatedAt");
    expect(
      resolveCardSettings(recentEntries.settings, {
        collection: "posts",
        sort: "title",
      }).sort
    ).toBe("title");
  });

  it("take the starting value for a new control whose stored value is the wrong kind", () => {
    expect(
      resolveCardSettings(recentEntries.settings, { collection: 7 }).collection
    ).toBe(undefined);
  });

  it("are handed only for declared settings, in a record with no prototype", () => {
    const resolved = resolveCardSettings(recentEntries.settings, {
      collection: "posts",
      stray: "kept in storage, never handed on",
    });
    expect(Object.getPrototypeOf(resolved)).toBe(null);
    expect("stray" in resolved).toBe(false);
  });
});
