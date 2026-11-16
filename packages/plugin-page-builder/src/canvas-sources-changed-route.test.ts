/**
 * The change check's mark: the same while nothing the canvas reads has
 * changed, different once an entry, a Single or a listed collection is saved
 * or gains or loses an entry, and fixed for a source the caller may not read.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import {
  NEWEST_MARKED,
  sourcesChangedStamp,
  type SourcesChangedReads,
} from "./canvas-sources-changed-route";

/** A stored document as a read answers it: its id and its version. */
interface Doc {
  id: string;
  _rev: number;
}

/** The sources as stored, newest save first in each collection. */
interface Stored {
  entries: Record<string, Doc>;
  singles: Record<string, Doc>;
  lists: Record<string, Doc[]>;
  refused: Set<string>;
  broken: Set<string>;
}

function readsOf(stored: Stored): SourcesChangedReads {
  const guard = (name: string) => {
    if (stored.refused.has(name)) throw NextlyError.forbidden();
    if (stored.broken.has(name)) throw new Error("connection reset");
  };
  return {
    entry: async (collection, id) => {
      guard(collection);
      return stored.entries[`${collection}/${id}`];
    },
    single: async slug => {
      guard(slug);
      return stored.singles[slug];
    },
    collection: async slug => {
      guard(slug);
      const rows = stored.lists[slug] ?? [];
      return { newest: rows.slice(0, NEWEST_MARKED), total: rows.length };
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
    entries: { "pages/p1": { id: "p1", _rev: 3 } },
    singles: {
      home: { id: "home", _rev: 2 },
      footer: { id: "footer", _rev: 1 },
    },
    // Newest first: "a" edited once since it was made, the others not.
    lists: {
      posts: [
        { id: "a", _rev: 2 },
        { id: "b", _rev: 1 },
        { id: "c", _rev: 1 },
        { id: "d", _rev: 1 },
      ],
    },
    refused: new Set(),
    broken: new Set(),
  };
}

/** Save `id` of collection `slug` again: one version on, and now newest. */
function saveAgain(s: Stored, slug: string, id: string): void {
  const rows = s.lists[slug] ?? [];
  const row = rows.find(entry => entry.id === id);
  if (row === undefined) throw new Error(`no ${id}`);
  s.lists[slug] = [
    { ...row, _rev: row._rev + 1 },
    ...rows.filter(entry => entry !== row),
  ];
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
        s.entries["pages/p1"] = { id: "p1", _rev: 4 };
      },
    ],
    [
      "a Single it binds is saved",
      (s: Stored) => {
        s.singles.footer = { id: "footer", _rev: 2 };
      },
    ],
    [
      "the newest entry of a listed collection is saved again",
      (s: Stored) => saveAgain(s, "posts", "a"),
    ],
    [
      "an older entry of a listed collection is saved, to the same version the newest had",
      (s: Stored) => saveAgain(s, "posts", "b"),
    ],
    [
      "a listed collection loses an entry",
      (s: Stored) => {
        s.lists.posts = (s.lists.posts ?? []).filter(entry => entry.id !== "d");
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
    refused.singles.footer = { id: "footer", _rev: 9 };
    expect(await sourcesChangedStamp(ASK, readsOf(refused))).toBe(first);
    // CONTROL: read, the same change does change the mark.
    expect(await sourcesChangedStamp(ASK, readsOf(stored()))).not.toBe(first);
  });

  it("is the same whichever order a read hands back entries saved in the same second", async () => {
    const tied = stored();
    const first = await sourcesChangedStamp(ASK, readsOf(tied));
    tied.lists.posts = [...(tied.lists.posts ?? [])].reverse();
    expect(await sourcesChangedStamp(ASK, readsOf(tied))).toBe(first);
  });

  it("fails, rather than answer a mark that would read as a change, when a read fails for another reason", async () => {
    const broken = stored();
    broken.broken.add("posts");
    await expect(sourcesChangedStamp(ASK, readsOf(broken))).rejects.toThrow(
      "connection reset"
    );
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
