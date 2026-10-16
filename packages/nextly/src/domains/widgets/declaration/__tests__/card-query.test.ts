/**
 * A card's settings, as the person left them, decide the query core runs for
 * it; and where a stored value is missing, no longer fits, or is hidden by the
 * setting it depends on, the starting value decides instead.
 *
 * The declaration is built with `defineWidget` and the real builders, so the
 * settings it holds are exactly what a plugin's would be.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "../../../../errors/nextly-error";

import { buildCardQuery, resolveCardSettings } from "../card-query";
import { defineWidget } from "../define-widget";
import { settings } from "../setting-builders";

const recentEntries = defineWidget({
  id: "test/recent-entries",
  title: "Recent entries",
  description: "The newest entries of one collection",
  category: "Test",
  widths: ["full"],
  width: "full",
  settings: {
    collection: settings.collection(),
    sort: settings.sort({ of: "collection", default: "-updatedAt" }),
    range: settings.dateRange({ default: "30d" }),
    items: settings.items({ default: 5 }),
  },
  data: {
    query: ({ settings }) => ({
      collection: settings.collection,
      op: "list",
      sort: settings.sort,
      where: { createdAt: { after: settings.range } },
      limit: settings.items,
    }),
  },
  display: "list",
});

describe("the query core runs for a card", () => {
  it("is written from the person's own values", () => {
    expect(
      buildCardQuery(recentEntries, {
        collection: "posts",
        sort: "title",
        range: "7d",
        items: 12,
      })
    ).toEqual({
      source: "collection:posts",
      op: "list",
      sort: "title",
      where: { createdAt: { after: "7d" } },
      limit: 12,
    });
  });

  it.each([
    ["the collection", { collection: "pages" }, { source: "collection:pages" }],
    [
      "the date range",
      { range: "90d" },
      { where: { createdAt: { after: "90d" } } },
    ],
    ["the number of items", { items: 3 }, { limit: 3 }],
  ])("changes with %s", (_label, changed, expected) => {
    // One setting changed against the same baseline: the query changes in
    // exactly the part that setting writes, and nowhere else.
    const base = { collection: "posts", sort: "title", range: "7d", items: 12 };
    const before = buildCardQuery(recentEntries, base);
    const after = buildCardQuery(recentEntries, { ...base, ...changed });
    expect(after).toEqual({ ...before, ...expected });
    expect(after).not.toEqual(before);
  });

  it("is not built for a card whose collection is not chosen yet", () => {
    expect(buildCardQuery(recentEntries, { items: 3 })).toBeUndefined();
  });

  it("does not run the query function while a setting it reads has no value", () => {
    // Typed as a string, so a valid widget may call a method on it: run before
    // a card's collection is chosen, this would throw.
    const query = vi.fn(
      ({ settings }: { settings: { collection: string } }) => ({
        collection: settings.collection.trim(),
        op: "count" as const,
      })
    );
    const trims = defineWidget({
      id: "test/trims",
      title: "Trims",
      description: "Counts one collection",
      category: "Test",
      widths: ["full"],
      width: "full",
      settings: { collection: settings.collection() },
      data: { query },
      display: "metric",
    });
    expect(buildCardQuery(trims, undefined)).toBeUndefined();
    expect(query).not.toHaveBeenCalled();
    expect(buildCardQuery(trims, { collection: " posts " })).toMatchObject({
      source: "collection:posts",
    });
  });

  it("names a collection the site renamed by the slug the site uses", () => {
    const base = { collection: "orders", sort: "title", range: "7d", items: 1 };
    expect(
      buildCardQuery(recentEntries, base, { orders: "sales" })
    ).toMatchObject({ source: "collection:sales" });
    // Only the owner's renamed collections move; any other is as written.
    expect(
      buildCardQuery(
        recentEntries,
        { ...base, collection: "posts" },
        {
          orders: "sales",
        }
      )
    ).toMatchObject({ source: "collection:posts" });
  });

  it.each([
    [
      "answers a promise",
      async () => ({ collection: "posts", op: "count" }),
      "a promise",
    ],
    ["names no collection", () => ({ op: "count" }), "named no collection"],
  ])(
    "refuses a plain JavaScript query function that %s",
    (_label, query, reason) => {
      const declaration = { data: { query }, settings: {} };
      let thrown: unknown;
      try {
        buildCardQuery(declaration, undefined);
      } catch (error) {
        thrown = error;
      }
      expect(thrown).toBeInstanceOf(NextlyError);
      expect((thrown as NextlyError).logMessage).toContain(reason);
    }
  );

  it("is not built for a widget whose data is a data function", () => {
    const fn = defineWidget({
      id: "test/fn",
      title: "Fn",
      description: "A data function",
      category: "Test",
      widths: ["full"],
      width: "full",
      data: async () => ({ total: 1 }),
      display: "metric",
    });
    expect(buildCardQuery(fn, {})).toBeUndefined();
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
