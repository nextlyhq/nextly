/**
 * A shared style's usage as the route answers it: documents by kind, the
 * blocks on them, and the open document's saved share reported apart.
 */
import { describe, expect, it } from "vitest";

import { usageHereOf, usageOf } from "./shared-style-usage-here";
import type { DocumentsUsing } from "./usage-count";

const kindOf = (collection: string) =>
  collection === "components" ? ("components" as const) : ("pages" as const);

const found: DocumentsUsing = {
  collections: [
    { collection: "pages", documents: ["p1", "p2"], blocks: [2, 1] },
    { collection: "components", documents: ["k1"], blocks: [3] },
    { collection: "home", documents: [null], blocks: [4], single: true },
  ],
  complete: true,
  countsBlocks: true,
};

describe("a style's usage", () => {
  it("counts blocks across its documents, and documents by kind", () => {
    expect(usageOf(found, kindOf)).toEqual({
      documents: 4,
      byKind: { pages: 3, components: 1, patterns: 0, layouts: 0 },
      blocks: 10,
      complete: true,
    });
  });

  it("reports the open entry's saved share apart", () => {
    expect(
      usageOf(found, kindOf, { collection: "pages", id: "p1" }).here
    ).toEqual({ blocks: 2, kind: "pages" });
    expect(
      usageOf(found, kindOf, { collection: "components", id: "k1" }).here
    ).toEqual({ blocks: 3, kind: "components" });
  });

  it("reports a Single's saved share, matched as a Single", () => {
    expect(usageOf(found, kindOf, { single: "home" }).here).toEqual({
      blocks: 4,
      kind: "pages",
    });
    // A collection of the Single's slug is a different document.
    expect(
      usageOf(found, kindOf, { collection: "home", id: "x" }).here
    ).toEqual({ blocks: 0, kind: "pages" });
  });

  it("says 0 for an open entry that does not use the style", () => {
    expect(
      usageOf(found, kindOf, { collection: "pages", id: "p9" }).here
    ).toEqual({ blocks: 0, kind: "pages" });
  });

  it("is a floor while any document's blocks are not counted", () => {
    const usage = usageOf(
      {
        collections: [
          { collection: "pages", documents: ["p1", "p2"], blocks: [2, null] },
        ],
        complete: true,
        countsBlocks: true,
      },
      kindOf
    );
    expect(usage).toMatchObject({ blocks: 2, complete: false });
  });

  it("counts no blocks for an index that keeps none", () => {
    const usage = usageOf(
      {
        collections: [{ collection: "pages", documents: ["p1"] }],
        complete: true,
      },
      kindOf,
      { collection: "pages", id: "p1" }
    );
    expect(usage.blocks).toBeUndefined();
    expect(usage.here).toBeUndefined();
    expect(usage.complete).toBe(true);
  });
});

describe("the open document a usage read names", () => {
  const read = (here: string) =>
    usageHereOf(`https://site.test/x?here=${encodeURIComponent(here)}`);

  it("reads an entry by its collection and id, and a Single by its slug", () => {
    expect(read("pages/p1")).toEqual({ collection: "pages", id: "p1" });
    expect(read("pages/a/b")).toEqual({ collection: "pages", id: "a/b" });
    expect(read("single:home")).toEqual({ single: "home" });
  });

  it("names nothing for a value that names no document", () => {
    expect(usageHereOf("https://site.test/x")).toBeUndefined();
    for (const value of ["", "pages", "/p1", "pages/", "single:"]) {
      expect(read(value)).toBeUndefined();
    }
  });
});
