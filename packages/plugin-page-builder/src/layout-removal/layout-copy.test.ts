/**
 * A Layout's version, as a removal's copy records it and its guard compares
 * it: it moves with the Layout's content, not only with its `updatedAt`, which
 * MySQL and SQLite store to the second, so an edit in the same second as the
 * copy would otherwise leave it unchanged.
 *
 * @module layout-removal/layout-copy.test
 */
import { describe, expect, it } from "vitest";

import { versionOf } from "./layout-copy";

const SAME_SECOND = "2026-11-03T10:00:00.000Z";

const live = {
  id: "landing",
  title: "Landing",
  slug: "landing",
  description: "",
  status: "published",
  areas: [{ id: "row-1", area: "header", component: "c-1" }],
  updatedAt: SAME_SECOND,
};

describe("a Layout's version", () => {
  it("moves when the content changes within the same stored second", async () => {
    const edited = { ...live, title: "Landing, edited" };
    expect(await versionOf(edited, null)).not.toBe(await versionOf(live, null));
  });

  it("moves when another plugin's field changes within the same stored second", async () => {
    const before = { ...live, tagline: "Before" };
    const after = { ...live, tagline: "Edited meanwhile" };
    expect(await versionOf(after, null)).not.toBe(
      await versionOf(before, null)
    );
  });

  it("moves when only the working draft's content changes", async () => {
    const draft = { ...live, title: "Draft one" };
    const later = { ...live, title: "Draft two" };
    expect(await versionOf(live, later)).not.toBe(await versionOf(live, draft));
  });

  it("is the same for the same content read in another shape", async () => {
    // The hook's entry and a Direct API read can hand a relationship over as
    // its id or as the row, and the repeater as JSON text on SQLite.
    const asRead = {
      ...live,
      areas: JSON.stringify([
        { id: "row-1", area: "header", component: { id: "c-1", title: "H" } },
      ]),
    };
    expect(await versionOf(asRead, null)).toBe(await versionOf(live, null));
  });

  it("fits the column it is stored in", async () => {
    expect((await versionOf(live, live)).length).toBeLessThanOrEqual(128);
  });
});
