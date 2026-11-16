/**
 * The change check's mark: the same while nothing the canvas reads has
 * changed, different once an entry, a Single or a listed collection is saved
 * or gains or loses an entry, and fixed for a source the caller may not read.
 */
import { NextlyError } from "@nextlyhq/plugin-sdk";
import { describe, expect, it } from "vitest";

import { sourcesChangedAskOf } from "./canvas-bindings-contract";
import {
  NEWEST_MARKED,
  sourcesChangedStamp,
  type SourcesChangedReads,
} from "./canvas-sources-changed-route";

/**
 * A stored document as a read answers it: its id, its version, and any
 * relation, as the entry it names at depth 1 or its id at depth 0.
 */
interface Doc {
  id: string;
  _rev: number;
  author?: Doc;
}

/** The sources as stored, newest save first in each collection. */
interface Stored {
  entries: Record<string, Doc>;
  singles: Record<string, Doc>;
  lists: Record<string, Doc[]>;
  site: { applicationName: string | null; timezone: string | null };
  refused: Set<string>;
  broken: Set<string>;
}

/** The depths reads were asked at, in order. */
const depths: number[] = [];

/** `doc` as a read at `depth` answers it: relations as ids at depth 0. */
function atDepth(doc: Doc | undefined, depth: 0 | 1): unknown {
  if (doc === undefined || depth === 1 || doc.author === undefined) return doc;
  return { ...doc, author: doc.author.id };
}

function readsOf(stored: Stored): SourcesChangedReads {
  const guard = (name: string) => {
    if (stored.refused.has(name)) throw NextlyError.forbidden();
    if (stored.broken.has(name)) throw new Error("connection reset");
  };
  return {
    entry: async (collection, id, followed) => {
      guard(collection);
      const depth = followed.length === 0 ? 0 : 1;
      depths.push(depth);
      return atDepth(stored.entries[`${collection}/${id}`], depth);
    },
    single: async (slug, followed) => {
      guard(slug);
      const depth = followed.length === 0 ? 0 : 1;
      depths.push(depth);
      return atDepth(stored.singles[slug], depth);
    },
    site: async () => stored.site,
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
    entries: {
      "pages/p1": { id: "p1", _rev: 3, author: { id: "u7", _rev: 1 } },
    },
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
    site: { applicationName: "Acme", timezone: "Europe/Paris" },
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

  it("marks a followed relation's entry, read at depth 1, only where the page follows it", async () => {
    const following = { ...ASK, follows: { entry: ["author"], singles: {} } };
    const before = await sourcesChangedStamp(following, readsOf(stored()));
    const edited = stored();
    const page = edited.entries["pages/p1"];
    if (page?.author === undefined) throw new Error("no author");
    page.author = { ...page.author, _rev: 2 };
    // The author's name saved elsewhere: the page that follows it sees it.
    expect(await sourcesChangedStamp(following, readsOf(edited))).not.toBe(
      before
    );
    // CONTROL: a page that follows no relation reads at depth 0 and marks
    // only the page's own save.
    depths.length = 0;
    const plain = await sourcesChangedStamp(ASK, readsOf(stored()));
    expect(await sourcesChangedStamp(ASK, readsOf(edited))).toBe(plain);
    expect(new Set(depths)).toEqual(new Set([0]));
  });

  it("marks the site's settings where the page reads them, and only there", async () => {
    const reading = { ...ASK, site: true as const };
    const before = await sourcesChangedStamp(reading, readsOf(stored()));
    const moved = stored();
    moved.site = { ...moved.site, timezone: "Asia/Karachi" };
    expect(await sourcesChangedStamp(reading, readsOf(moved))).not.toBe(before);
    // CONTROL: a page that reads no setting is not moved by one.
    expect(await sourcesChangedStamp(ASK, readsOf(moved))).toBe(
      await sourcesChangedStamp(ASK, readsOf(stored()))
    );
  });

  it("marks a followed entry the caller may not read by its id alone", async () => {
    const following = { ...ASK, follows: { entry: ["author"], singles: {} } };
    // Unread, the relation comes back as the id it stores.
    const unread = (s: Stored): SourcesChangedReads => {
      const reads = readsOf(s);
      return { ...reads, entry: (c, id) => reads.entry(c, id, []) };
    };
    const before = await sourcesChangedStamp(following, unread(stored()));
    const edited = stored();
    const page = edited.entries["pages/p1"];
    if (page?.author === undefined) throw new Error("no author");
    page.author = { ...page.author, _rev: 5 };
    expect(await sourcesChangedStamp(following, unread(edited))).toBe(before);
  });

  it("reads a Single's page by the Single itself", async () => {
    const asked: string[] = [];
    const reads = readsOf(stored());
    await sourcesChangedStamp(
      { source: { kind: "single", slug: "home" }, singles: [], lists: [] },
      {
        ...reads,
        single: async (slug, followed) => {
          asked.push(slug);
          return reads.single(slug, followed);
        },
      }
    );
    expect(asked).toEqual(["home"]);
  });
});

describe("the change check's ask", () => {
  it("names the relations the bindings follow and the language being edited", () => {
    expect(
      sourcesChangedAskOf({
        source: { kind: "collection", slug: "posts", id: "p1" },
        demand: {
          entry: { fields: ["title"], follows: { author: ["name"] } },
          singles: {
            home: { fields: ["tagline"], follows: {} },
            footer: { fields: [], follows: { owner: ["name"] } },
          },
          site: false,
          formatsDates: false,
        },
        lists: ["posts"],
        locale: "fr",
      })
    ).toEqual({
      source: { kind: "collection", slug: "posts", id: "p1" },
      singles: ["footer", "home"],
      lists: ["posts"],
      follows: { entry: ["author"], singles: { footer: ["owner"] } },
      locale: "fr",
    });
  });

  it("names the site's settings where a binding reads one or a date shows in its zone", () => {
    const request = {
      source: { kind: "single" as const, slug: "home" },
      demand: { singles: {}, site: false, formatsDates: false },
      lists: [],
    };
    expect(sourcesChangedAskOf(request).site).toBeUndefined();
    expect(
      sourcesChangedAskOf({
        ...request,
        demand: { ...request.demand, site: true },
      }).site
    ).toBe(true);
    expect(
      sourcesChangedAskOf({
        ...request,
        demand: { ...request.demand, formatsDates: true },
      }).site
    ).toBe(true);
  });
});
