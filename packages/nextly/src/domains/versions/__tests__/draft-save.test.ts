/**
 * "Did this save change anything": the comparison a held save is judged by
 * before it is recorded as a version.
 */
import { describe, expect, it } from "vitest";

import { sameContent } from "../draft-save";

describe("sameContent", () => {
  it("ignores the framework keys a save moves every time", () => {
    expect(
      sameContent(
        {
          id: "p1",
          title: "Hello",
          status: "published",
          updatedAt: "2026-10-16T07:00:00.000Z",
        },
        {
          id: "p1",
          title: "Hello",
          status: "draft",
          updatedAt: "2026-10-16T07:05:00.000Z",
        }
      )
    ).toBe(true);
  });

  it("sees a changed field, at any depth", () => {
    expect(sameContent({ title: "Hello" }, { title: "Hallo" })).toBe(false);
    expect(
      sameContent(
        { seo: { meta: { title: "A" } } },
        { seo: { meta: { title: "B" } } }
      )
    ).toBe(false);
    expect(sameContent({ tags: ["a", "b"] }, { tags: ["b", "a"] })).toBe(false);
  });

  it("sees a field added or removed", () => {
    expect(sameContent({ title: "Hello" }, { title: "Hello", body: "" })).toBe(
      false
    );
  });

  it("does not depend on key order", () => {
    expect(
      sameContent({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 3, c: 2 }, a: 1 })
    ).toBe(true);
  });

  it("treats a date read back as text the same as the date in memory", () => {
    const at = new Date("2026-10-16T07:00:00.000Z");
    expect(
      sameContent({ publishOn: at }, { publishOn: "2026-10-16T07:00:00.000Z" })
    ).toBe(true);
  });

  it("treats a framework key nested inside content as content", () => {
    // Only the document's own top-level keys are framework keys; a group
    // field that happens to hold a `status` is something an editor wrote.
    expect(
      sameContent(
        { review: { status: "open" } },
        { review: { status: "done" } }
      )
    ).toBe(false);
  });

  it("ignores a component row's own timestamps, and nothing else in it", () => {
    // A save rewrites a component's row, moving its timestamps; at second
    // precision two saves may or may not share them, so they cannot decide.
    const row = (updatedAt: string, label: string) => ({
      account: {
        _componentType: "account",
        id: "c1",
        created_at: updatedAt,
        updated_at: updatedAt,
        label,
      },
    });
    expect(
      sameContent(
        row("2026-10-17T12:14:48.000Z", "L"),
        row("2026-10-17T12:14:49.000Z", "L")
      )
    ).toBe(true);
    expect(
      sameContent(
        row("2026-10-17T12:14:48.000Z", "L"),
        row("2026-10-17T12:14:48.000Z", "M")
      )
    ).toBe(false);
    // A group that is not a component has no framework columns.
    expect(
      sameContent(
        { meta: { updated_at: "2026-10-17" } },
        { meta: { updated_at: "2026-10-18" } }
      )
    ).toBe(false);
  });

  it("counts a Single's createdBy as content, and a collection's as its owner column", () => {
    // A Single has no owner column, so a field it declares as createdBy is
    // something an editor wrote.
    const before = { title: "A", createdBy: "Ana" };
    const after = { title: "A", createdBy: "Ben" };
    expect(sameContent(before, after, "single")).toBe(false);
    expect(sameContent(before, after, "collection")).toBe(true);
  });
});
