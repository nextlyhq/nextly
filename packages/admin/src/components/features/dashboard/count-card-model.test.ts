/**
 * How a Count card reads its cells: the number from the split or the plain
 * count, the split's links under the card's Filter, and the trend's change.
 */
import type { WidgetSlot } from "nextly/widget-result";
import { describe, expect, it } from "vitest";

import { countView } from "./count-card-model";

const split: WidgetSlot = {
  ok: true,
  result: {
    op: "groupBy",
    buckets: [
      { value: "published", count: 7 },
      { value: "draft", count: 3 },
      { value: null, count: 1 },
    ],
  },
};

describe("the Count card's view of its cells", () => {
  it("is the split's buckets summed, the null bucket included, with each part linking to its list", () => {
    const view = countView({ split }, { collection: "posts" });
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
    const view = countView({ split }, { collection: "posts", filter });
    if (view.state !== "ready") throw new Error(view.state);
    const where = encodeURIComponent(JSON.stringify(filter)).replaceAll(
      "%20",
      "+"
    );
    expect(view.split?.draft.href).toBe(
      `/admin/collections/posts?status=draft&where=${where}`
    );
  });

  it("counts what scheduled releases will publish, linking to that list under the card's Filter", () => {
    const filter = { title: { contains: "news" } };
    const view = countView(
      {
        split,
        scheduled: { ok: true, result: { op: "count", total: 2 } },
      },
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

  it("shows a scheduled figure of zero, and leaves it out when not available or failed", () => {
    const zero = countView(
      { split, scheduled: { ok: true, result: { op: "count", total: 0 } } },
      { collection: "posts" }
    );
    expect(zero.state === "ready" && zero.scheduled?.count).toBe(0);
    for (const scheduled of [
      { ok: false, error: "x", code: "unavailable" },
      { ok: false, error: "Down" },
    ] as const) {
      const view = countView({ split, scheduled }, { collection: "posts" });
      // One part of the card: the number and split still draw.
      expect(view).toMatchObject({ state: "ready", total: 11 });
      expect("scheduled" in view).toBe(false);
    }
  });

  it("is the plain count, with no split, for a collection without a lifecycle", () => {
    const view = countView(
      { total: { ok: true, result: { op: "count", total: 4 } } },
      { collection: "notes" }
    );
    expect(view).toMatchObject({ state: "ready", total: 4 });
    expect("split" in view).toBe(false);
  });

  it("measures the last 30 days against the 30 before", () => {
    const view = countView(
      {
        split,
        trend: {
          ok: true,
          result: {
            op: "timeseries",
            interval: "day",
            points: [
              { start: "2026-10-20T00:00:00.000Z", count: 2 },
              { start: "2026-10-21T00:00:00.000Z", count: 5 },
            ],
          },
        },
        prior: { ok: true, result: { op: "count", total: 4 } },
      },
      { collection: "posts" }
    );
    if (view.state !== "ready") throw new Error(view.state);
    expect(view.trend).toMatchObject({ recent: 7, prior: 4, change: 3 });
  });

  it("is loading before the number has answered, and not available when its read was refused", () => {
    expect(countView({}, { collection: "posts" })).toEqual({
      state: "loading",
    });
    expect(
      countView(
        { split: { ok: false, error: "x", code: "unavailable" } },
        { collection: "posts" }
      )
    ).toEqual({ state: "unavailable" });
    expect(countView({ split }, {})).toEqual({ state: "unavailable" });
  });
});
