/**
 * Whether a page's row as a check found it differs from the row stored,
 * apart from when it was checked. MySQL's JSON columns give an object's keys
 * back in their own order, so keys in another order are the same value; an
 * array's order, every value and every key still count.
 */
import { describe, expect, it } from "vitest";

import { rowUnchanged, sameJson } from "../row-change";

describe("two stored JSON values", () => {
  it("are the same with an object's keys in another order, at any depth", () => {
    expect(
      sameJson(
        { kind: "longTitle", subject: { type: "posts", id: "1" }, n: 2 },
        { n: 2, subject: { id: "1", type: "posts" }, kind: "longTitle" }
      )
    ).toBe(true);
    expect(
      sameJson(
        [{ to: ["a", "b"], listed: true, home: false }],
        [{ home: false, listed: true, to: ["a", "b"] }]
      )
    ).toBe(true);
  });

  it("differ where a value differs, numbers and text by value", () => {
    expect(sameJson({ n: 1 }, { n: 2 })).toBe(false);
    expect(sameJson({ n: 1 }, { n: "1" })).toBe(false);
    expect(sameJson({ text: "a" }, { text: "b" })).toBe(false);
    expect(sameJson({ on: true }, { on: false })).toBe(false);
    expect(sameJson(null, {})).toBe(false);
    expect(sameJson([], {})).toBe(false);
    expect(sameJson(1.5, 1.5)).toBe(true);
    expect(sameJson("a", "a")).toBe(true);
  });

  it("differ where an array's items come in another order", () => {
    expect(sameJson(["a", "b"], ["b", "a"])).toBe(false);
    expect(sameJson([{ id: 1 }, { id: 2 }], [{ id: 2 }, { id: 1 }])).toBe(
      false
    );
    expect(sameJson(["a"], ["a", "a"])).toBe(false);
  });

  it("differ where a key is missing or extra", () => {
    expect(sameJson({ a: 1, b: 2 }, { a: 1 })).toBe(false);
    expect(sameJson({ a: 1 }, { a: 1, b: 2 })).toBe(false);
    expect(sameJson({ a: 1, b: null }, { a: 1, c: null })).toBe(false);
  });
});

describe("a page's row, against the row stored", () => {
  const found = {
    kind: "page",
    holderCollection: "posts",
    holderId: "7",
    locale: "en",
    label: "Harbour",
    path: "/blog/harbour",
    title: "Harbour",
    description: null,
    problems: [
      {
        kind: "noDescription",
        subject: { type: "posts", id: "7", label: "Harbour" },
        fix: { place: "page", tab: "seo", field: "description" },
      },
    ],
    links: { to: ["posts:1:en"], listed: true, home: false },
    checkedAt: "2026-11-19T02:00:00.000Z",
  };
  /** The row as MySQL gives it back: keys reordered, checked a day before. */
  const stored = {
    id: 12,
    rowKey: "k",
    kind: "page",
    holderCollection: "posts",
    holderId: "7",
    locale: "en",
    label: "Harbour",
    path: "/blog/harbour",
    title: "Harbour",
    description: null,
    problems: [
      {
        fix: { field: "description", place: "page", tab: "seo" },
        kind: "noDescription",
        subject: { id: "7", label: "Harbour", type: "posts" },
      },
    ],
    links: { home: false, listed: true, to: ["posts:1:en"] },
    checkedAt: "2026-11-18T02:00:00.000Z",
  };

  it("is unchanged where only when it was checked differs", () => {
    expect(rowUnchanged(found, stored)).toBe(true);
  });

  it("is unchanged where the store gives its JSON back as text, or nothing for a null", () => {
    const { description: _none, ...withoutDescription } = stored;
    expect(
      rowUnchanged(found, {
        ...withoutDescription,
        problems: JSON.stringify(stored.problems),
        links: JSON.stringify(stored.links),
      })
    ).toBe(true);
  });

  it("is unchanged where what was found holds a key with no value, which JSON leaves out", () => {
    expect(
      rowUnchanged(
        { ...found, links: { ...found.links, origin: undefined } },
        stored
      )
    ).toBe(true);
  });

  it("is changed where anything else differs", () => {
    expect(rowUnchanged({ ...found, title: "Harbour at dawn" }, stored)).toBe(
      false
    );
    expect(rowUnchanged({ ...found, problems: [] }, stored)).toBe(false);
    expect(
      rowUnchanged(
        { ...found, links: { ...found.links, to: ["posts:2:en"] } },
        stored
      )
    ).toBe(false);
    expect(
      rowUnchanged({ ...found, links: { to: [], listed: true } }, stored)
    ).toBe(false);
    expect(rowUnchanged({ ...found, description: "" }, stored)).toBe(false);
  });

  it("is changed where the stored JSON cannot be read", () => {
    expect(rowUnchanged(found, { ...stored, links: "{not json" })).toBe(false);
  });
});
