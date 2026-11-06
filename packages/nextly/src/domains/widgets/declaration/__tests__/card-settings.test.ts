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

import {
  hasFieldSettingValue,
  resolveCardSettings,
  staleFieldSettings,
  unsetSetting,
} from "../card-settings";
import { defineWidget } from "../define-widget";
import { setting } from "../setting-builders";

const recentEntries = defineWidget({
  id: "test/recent-entries",
  title: "Recent entries",
  description: "The newest entries of one collection",
  category: "Test",
  size: { default: { w: 12, h: 4 } },
  settings: {
    collection: setting.collection({ label: "Collection" }),
    sort: setting.sort({
      of: "collection",
      label: "Sort",
      defaultValue: "-updatedAt",
    }),
    range: setting.dateRange({ label: "Date range", defaultValue: "30d" }),
    items: setting.number({
      label: "Number of items",
      defaultValue: 5,
      min: 1,
      max: 10,
    }),
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
    // It is named by its label, as the card's settings sheet names it.
    const stored = resolveCardSettings(recentEntries.settings, undefined);
    expect(unsetSetting(recentEntries.settings, stored)).toEqual({
      name: "collection",
      label: "Collection",
    });
  });

  it("is named by its key where it states no label", () => {
    // A stored definition may omit a label, which startup refuses only in a
    // declaration: the sheet names such a setting by its key, and so does this.
    expect(unsetSetting({ collection: { type: "collection" } }, {})).toEqual({
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

describe("a Field setting judged against the reader's collections", () => {
  const settings = {
    collection: setting.collection({ label: "Collection" }),
    field: setting.fieldOf({ of: "collection", label: "Field" }),
  };
  const orders = {
    collection: "orders",
    label: "Orders",
    lifecycle: false,
    titleField: "title",
    fields: [
      { name: "title", label: "Title", type: "string" as const },
      { name: "state", label: "State", type: "string" as const },
    ],
  };
  const stale = (values: Record<string, unknown>) =>
    staleFieldSettings(settings, values, [orders]);

  it("keeps a field the chosen collection offers its reader", () => {
    expect(stale({ collection: "orders", field: "state" })).toEqual([]);
  });

  it("finds a field the collection does not offer, or one in a collection the reader may not read", () => {
    // Removed, or not offered to this reader: either way not among its published fields. With no
    // default, each is replaced by no value at all.
    expect(stale({ collection: "orders", field: "cost" })).toEqual([
      ["field", undefined],
    ]);
    // A collection with no published source of the reader's.
    expect(stale({ collection: "invoices", field: "state" })).toEqual([
      ["field", undefined],
    ]);
  });

  it("replaces a stale field with a default the collection offers, as the settings sheet does", () => {
    const defaulted = (defaultValue: string, value: string) =>
      staleFieldSettings(
        {
          collection: settings.collection,
          field: setting.fieldOf({
            of: "collection",
            label: "Field",
            defaultValue,
          }),
        },
        { collection: "orders", field: value },
        [orders]
      );
    expect(defaulted("state", "cost")).toEqual([["field", "state"]]);
    // The must-differ halves: a default the collection does not offer, and a
    // stale value that is the default itself, are each replaced by none.
    expect(defaulted("gone", "cost")).toEqual([["field", undefined]]);
    expect(defaulted("gone", "gone")).toEqual([["field", undefined]]);
  });

  it("judges only a Field setting with a value", () => {
    expect(stale({ collection: "orders" })).toEqual([]);
    expect(hasFieldSettingValue(settings, { collection: "orders" })).toBe(
      false
    );
    expect(
      hasFieldSettingValue(settings, { collection: "orders", field: "state" })
    ).toBe(true);
  });
});
