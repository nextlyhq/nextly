/**
 * How a Count card reads the data its `load` answers: the number and its
 * split, each part's link under the card's Filter, the scheduled figure only
 * where it was answered, and the trend's change.
 */
import type { CountWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import { collectionLabelOf, countView } from "./count-card-model";

const DATA: CountWidgetData = {
  total: 11,
  split: { published: 7, draft: 3 },
};

describe("the Count card's view of its data", () => {
  it("is the number, with each part of its split linking to its list", () => {
    const view = countView(DATA, { collection: "posts" });
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.total).toBe(11);
    expect(view.href).toBe("/admin/collections/posts");
    expect(view.split).toEqual({
      published: {
        count: 7,
        href: "/admin/collections/posts?status=published",
      },
      draft: { count: 3, href: "/admin/collections/posts?status=draft" },
    });
  });

  it("carries the card's Filter into every link", () => {
    const filter = { title: { contains: "news" } };
    const view = countView(DATA, { collection: "posts", filter });
    if (view.state !== "ready") throw new Error(view.state);
    const where = encodeURIComponent(JSON.stringify(filter)).replaceAll(
      "%20",
      "+"
    );
    expect(view.split?.draft.href).toBe(
      `/admin/collections/posts?status=draft&where=${where}`
    );
  });

  it("names no filter for a Filter of no conditions", () => {
    const view = countView(DATA, { collection: "posts", filter: {} });
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.href).toBe("/admin/collections/posts");
  });

  it("counts what scheduled releases will publish, linking to that list under the card's Filter", () => {
    const filter = { title: { contains: "news" } };
    const view = countView(
      { ...DATA, scheduled: 2 },
      { collection: "posts", filter }
    );
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.scheduled?.count).toBe(2);
    const href = view.scheduled?.href ?? "";
    expect(href.split("?")[0]).toBe("/admin/collections/posts");
    // The release condition at the top level, beside the Filter, where the
    // list reads it.
    expect(
      JSON.parse(new URLSearchParams(href.split("?")[1]).get("where") ?? "null")
    ).toEqual({ title: { contains: "news" }, _inRelease: true });
  });

  it("shows a scheduled figure of zero, and leaves it out where the load left it out", () => {
    const zero = countView({ ...DATA, scheduled: 0 }, { collection: "posts" });
    expect(zero.state === "ready" && zero.scheduled?.count).toBe(0);
    const view = countView(DATA, { collection: "posts" });
    // One part of the card: the number and split still draw.
    expect(view).toMatchObject({ state: "ready", total: 11 });
    expect("scheduled" in view).toBe(false);
  });

  it("is the plain count, with no split, for a collection without a lifecycle", () => {
    const view = countView({ total: 4 }, { collection: "notes" });
    expect(view).toMatchObject({ state: "ready", total: 4 });
    expect("split" in view).toBe(false);
  });

  it("measures the last 30 days against the 30 before", () => {
    const view = countView(
      {
        ...DATA,
        trend: {
          points: [
            { start: "2026-10-20T00:00:00.000Z", count: 2 },
            { start: "2026-10-21T00:00:00.000Z", count: 5 },
          ],
          prior: 4,
        },
      },
      { collection: "posts" }
    );
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.trend).toMatchObject({ recent: 7, prior: 4, change: 3 });
  });

  it("is not available for a card set to no collection", () => {
    expect(countView(DATA, {})).toEqual({ state: "unavailable" });
  });
});

describe("the name a Count card shows for its collection", () => {
  it("is the label the server published, or the slug where none is known", () => {
    const sources = [{ collection: "posts", label: "Blog posts" }];
    expect(collectionLabelOf({ collection: "posts" }, sources)).toBe(
      "Blog posts"
    );
    expect(collectionLabelOf({ collection: "pages" }, sources)).toBe("pages");
    expect(collectionLabelOf({}, sources)).toBeUndefined();
  });
});
