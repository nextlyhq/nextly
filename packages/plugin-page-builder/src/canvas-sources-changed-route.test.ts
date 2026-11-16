/**
 * The change check's mark: the same while nothing the canvas reads has
 * changed, different once an entry, a Single or a listed collection is saved
 * or gains or loses an entry, and fixed for a source the caller may not read.
 */
import { describe, expect, it } from "vitest";

import {
  sourcesChangedStamp,
  type SourcesChangedReads,
} from "./canvas-sources-changed-route";

/** The sources as stored: each save time, and each collection's entries. */
interface Stored {
  entries: Record<string, string>;
  singles: Record<string, string>;
  lists: Record<string, { latest: string; total: number }>;
  refused: Set<string>;
}

function readsOf(stored: Stored): SourcesChangedReads {
  const refuse = (name: string) => {
    if (stored.refused.has(name)) throw new Error("refused");
  };
  return {
    entry: async (collection, id) => {
      refuse(collection);
      return stored.entries[`${collection}/${id}`];
    },
    single: async slug => {
      refuse(slug);
      return stored.singles[slug];
    },
    collection: async slug => {
      refuse(slug);
      return stored.lists[slug] ?? { latest: undefined, total: 0 };
    },
  };
}

const ASK = {
  source: { kind: "collection" as const, slug: "pages", id: "p1" },
  singles: ["home", "footer"],
  lists: ["posts"],
};

function stored(): Stored {
  return {
    entries: { "pages/p1": "2026-11-16T10:00:00.000Z" },
    singles: {
      home: "2026-11-16T09:00:00.000Z",
      footer: "2026-11-16T08:00:00.000Z",
    },
    lists: { posts: { latest: "2026-11-16T07:00:00.000Z", total: 4 } },
    refused: new Set(),
  };
}

describe("the change check's mark", () => {
  it("is the same while nothing read has changed, whatever order the sources are named in", async () => {
    const now = await sourcesChangedStamp(ASK, readsOf(stored()));
    expect(await sourcesChangedStamp(ASK, readsOf(stored()))).toBe(now);
    expect(
      await sourcesChangedStamp(
        { ...ASK, singles: ["footer", "home"] },
        readsOf(stored())
      )
    ).toBe(now);
  });

  it.each([
    [
      "the page's own entry is saved",
      (s: Stored) => {
        s.entries["pages/p1"] = "2026-11-16T11:00:00.000Z";
      },
    ],
    [
      "a Single it binds is saved",
      (s: Stored) => {
        s.singles.footer = "2026-11-16T11:00:00.000Z";
      },
    ],
    [
      "an entry of a listed collection is saved",
      (s: Stored) => {
        s.lists.posts = { latest: "2026-11-16T11:00:00.000Z", total: 4 };
      },
    ],
    [
      "a listed collection loses an entry, its newest save the same",
      (s: Stored) => {
        s.lists.posts = { latest: "2026-11-16T07:00:00.000Z", total: 3 };
      },
    ],
  ])("changes when %s", async (_, change) => {
    const before = await sourcesChangedStamp(ASK, readsOf(stored()));
    const after = stored();
    change(after);
    expect(await sourcesChangedStamp(ASK, readsOf(after))).not.toBe(before);
  });

  it("marks a source the caller may not read the same way each time, so it never reads as changing", async () => {
    const refused = stored();
    refused.refused.add("footer");
    const first = await sourcesChangedStamp(ASK, readsOf(refused));
    refused.singles.footer = "2026-11-16T12:00:00.000Z";
    expect(await sourcesChangedStamp(ASK, readsOf(refused))).toBe(first);
    // CONTROL: read, the same change does change the mark.
    expect(await sourcesChangedStamp(ASK, readsOf(stored()))).not.toBe(first);
  });

  it("reads a Single's page by the Single itself", async () => {
    const asked: string[] = [];
    const reads = readsOf(stored());
    await sourcesChangedStamp(
      { source: { kind: "single", slug: "home" }, singles: [], lists: [] },
      {
        ...reads,
        single: async slug => {
          asked.push(slug);
          return reads.single(slug);
        },
      }
    );
    expect(asked).toEqual(["home"]);
  });
});
