/**
 * How a Count card reads the data its `load` answers: what the number counts
 * and where it links, the one line under it, each part of the split linking
 * under the card's Filter, and the scheduled figure only where it was
 * answered.
 */
import type { CountWidgetData } from "nextly/core-widget-data";
import { describe, expect, it } from "vitest";

import {
  changeSentence,
  collectionLabelOf,
  countView,
} from "./count-card-model";

const SPLIT: CountWidgetData = {
  total: 10,
  counted: "all",
  line: "split",
  split: { published: 7, draft: 3 },
};

/** The ready view, or a failure naming the state it was in instead. */
function ready(data: CountWidgetData, settings: Record<string, unknown>) {
  const view = countView(data, settings);
  if (view.state !== "ready") throw new Error(view.state);
  return view;
}

describe("the Count card's view of its data", () => {
  it("names what the number counts, and links it to that list", () => {
    const base = { total: 4, line: "none" } as const;
    expect(
      ready({ ...base, counted: "all" }, { collection: "posts" })
    ).toMatchObject({ label: "Entries", href: "/admin/collections/posts" });
    expect(
      ready({ ...base, counted: "published" }, { collection: "posts" })
    ).toMatchObject({
      label: "Published",
      href: "/admin/collections/posts?status=published",
    });
    expect(
      ready({ ...base, counted: "draft" }, { collection: "posts" })
    ).toMatchObject({
      label: "Drafts",
      href: "/admin/collections/posts?status=draft",
    });
  });

  it("counts people for Users, linking to the users list whatever its Filter holds", () => {
    const view = ready(
      { total: 12, counted: "people", line: "change", change: 1 },
      { collection: "users", filter: { title: { contains: "x" } } }
    );
    expect(view).toMatchObject({
      label: "People",
      total: 12,
      href: "/admin/users",
      line: { kind: "change", change: 1 },
    });
  });

  it("splits by status, each part linking to its list", () => {
    expect(ready(SPLIT, { collection: "posts" }).line).toEqual({
      kind: "split",
      published: {
        count: 7,
        href: "/admin/collections/posts?status=published",
      },
      draft: { count: 3, href: "/admin/collections/posts?status=draft" },
    });
  });

  it("carries the card's Filter into every link", () => {
    const filter = { title: { contains: "news" } };
    const view = ready(SPLIT, { collection: "posts", filter });
    const where = encodeURIComponent(JSON.stringify(filter)).replaceAll(
      "%20",
      "+"
    );
    expect(view.href).toBe(`/admin/collections/posts?where=${where}`);
    if (view.line.kind !== "split") throw new Error(view.line.kind);
    expect(view.line.draft.href).toBe(
      `/admin/collections/posts?status=draft&where=${where}`
    );
  });

  it("links what scheduled releases will publish to exactly that list, only where it was read", () => {
    const view = ready(
      { ...SPLIT, split: { published: 7, draft: 3, scheduled: 2 } },
      { collection: "posts" }
    );
    if (view.line.kind !== "split") throw new Error(view.line.kind);
    expect(view.line.scheduled?.count).toBe(2);
    expect(view.line.scheduled?.href).toContain("where=");
    const without = ready(SPLIT, { collection: "posts" });
    if (without.line.kind !== "split") throw new Error(without.line.kind);
    expect(without.line.scheduled).toBeUndefined();
  });

  it("draws no line where the line it asked could not be read", () => {
    const view = ready(
      { total: 3, counted: "all", line: "change" },
      { collection: "posts" }
    );
    expect(view.line).toEqual({ kind: "none" });
    const trendless = ready(
      { total: 3, counted: "all", line: "trend" },
      { collection: "posts" }
    );
    expect(trendless.line).toEqual({ kind: "none" });
  });

  it("is not available when it is set to no collection", () => {
    expect(countView(SPLIT, {})).toEqual({ state: "unavailable" });
  });
});

describe("the change line", () => {
  const plain = (value: number) => value.toLocaleString("en-US");
  it("says what was made this week, or that nothing was", () => {
    expect(changeSentence(3, plain)).toBe("+3 this week");
    expect(changeSentence(1204, plain)).toBe("+1,204 this week");
    expect(changeSentence(0, plain)).toBe("No change this week");
  });
});

describe("what a Count card is set to, by name", () => {
  it("is the collection's label as published to the reader, or its slug", () => {
    const sources = [{ collection: "posts", label: "Articles" }];
    expect(collectionLabelOf({ collection: "posts" }, sources)).toBe(
      "Articles"
    );
    expect(collectionLabelOf({ collection: "notes" }, sources)).toBe("notes");
    expect(collectionLabelOf({}, sources)).toBeUndefined();
  });

  it("is Users for the people", () => {
    expect(collectionLabelOf({ collection: "users" }, [])).toBe("Users");
  });
});
