/**
 * The dry run of a breakpoint removal over an in-memory site: what each place
 * would lose, counted by document and by value, named only where the caller
 * may read, and never reported as nothing where something could not be read.
 */
import { DEFAULT_LIMITS, type NamedClass } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { documentKeyOf, type HostAddress } from "../host-rewrite/contract";
import type { HostDocument, HostRead } from "../host-rewrite/rewrite";
import { removedBreakpoints } from "../site-settings";

import {
  countRemoval,
  NAMED_AT_MOST,
  REMOVAL_PLACES,
  type DryRunDeps,
} from "./dry-run";

type Node = Record<string, unknown>;

const styled = (id: string, extra: Node = {}): Node => ({
  id,
  type: "core/text",
  version: 1,
  props: {},
  styles: { base: { mobile: { color: "#111", backgroundColor: "#eeeeee" } } },
  ...extra,
});

const page = (...nodes: Node[]) => ({ formatVersion: 1, kind: "page", nodes });

const value = (v: unknown) => ({ kind: "value" as const, value: v });

/** One stored document: where it is, how its host is reached, what it holds. */
interface Stored {
  host: HostAddress;
  access?: "write" | "read" | "scan";
  published?: unknown;
  draft?: unknown;
  /** Thrown when it is read. */
  unreadable?: boolean;
}

const entry = (slug: string, id: string): HostAddress => ({
  kind: "collection",
  slug,
  id,
  path: ["content"],
});

/** A site holding `stored`, with `readable` naming who the caller may read. */
function site(
  stored: Stored[],
  options: {
    readable?: (host: HostAddress) => boolean;
    /** Milliseconds every naming answer takes. */
    slowNames?: number;
    /** A document's title as saved, where a draft renamed it. */
    saved?: (host: HostAddress) => string | undefined;
    classes?: NamedClass[];
    deadline?: Date;
  } = {}
): DryRunDeps & {
  named: HostAddress[];
  batches: number[];
  savedAsks: HostAddress[][];
} {
  const named: HostAddress[] = [];
  const batches: number[] = [];
  const savedAsks: HostAddress[][] = [];
  const byKey = new Map(stored.map(s => [JSON.stringify(s.host), s]));
  return {
    named,
    batches,
    savedAsks,
    savedTitles: async hosts => {
      savedAsks.push([...hosts]);
      const titles = new Map<string, string>();
      for (const host of hosts) {
        const title = options.saved?.(host);
        if (title !== undefined) titles.set(documentKeyOf(host), title);
      }
      return titles;
    },
    documents: async function* () {
      for (const s of stored) {
        const document: HostDocument = {
          key: JSON.stringify(s.host),
          hosts: [{ host: s.host, access: s.access ?? "write" }],
        };
        yield document;
      }
    },
    read: async host => {
      const s = byKey.get(JSON.stringify(host));
      if (s === undefined || s.unreadable === true) throw new Error("gone");
      const read: HostRead = {
        published:
          s.published === undefined ? { kind: "absent" } : value(s.published),
        draft: s.draft === undefined ? null : value(s.draft),
        liveState: null,
      };
      return read;
    },
    placeOf: host =>
      host.kind === "single"
        ? "singles"
        : host.slug === "pages"
          ? "pages"
          : host.slug === "components"
            ? "components"
            : "entries",
    namesFor: async hosts => {
      named.push(...hosts);
      batches.push(hosts.length);
      const names = new Map<string, string>();
      for (const host of hosts) {
        if (options.readable?.(host) ?? true) {
          names.set(documentKeyOf(host), `${host.slug}/${host.id ?? ""}`);
        }
      }
      return options.slowNames === undefined
        ? names
        : new Promise(resolve =>
            setTimeout(() => resolve(names), options.slowNames)
          );
    },
    limits: DEFAULT_LIMITS,
    classes: options.classes ?? [],
    ...(options.deadline === undefined ? {} : { deadline: options.deadline }),
  };
}

const MOBILE = new Map([["mobile", "Mobile"]]);

describe("a breakpoint removal counted across the site", () => {
  it("counts each place's documents, drafts, styles and hides", async () => {
    const run = await countRemoval(
      MOBILE,
      site([
        { host: entry("pages", "p1"), published: page(styled("a")) },
        // Both forms hold it: each is dropped, so each is counted.
        {
          host: entry("pages", "p2"),
          published: page(styled("a")),
          draft: page(
            styled("a"),
            styled("b", {
              styles: {},
              visibility: { devices: { mobile: false } },
            })
          ),
        },
        { host: entry("components", "c1"), published: page(styled("x")) },
        { host: entry("pages", "plain"), published: page() },
      ])
    );
    const [mobile] = run.removed;
    expect(mobile?.places.pages).toEqual({
      documents: 2,
      drafts: 1,
      styles: 6,
      hides: 1,
    });
    expect(mobile?.places.components).toEqual({
      documents: 1,
      drafts: 0,
      styles: 2,
      hides: 0,
    });
    // Every place is answered, an empty one with zeros.
    expect(Object.keys(mobile?.places ?? {})).toEqual([...REMOVAL_PLACES]);
    expect(mobile?.places.layouts.documents).toBe(0);
    expect(mobile?.documents).toEqual({
      named: ["pages/p1", "pages/p2", "components/c1"],
      unnamed: 0,
    });
    expect(run).toMatchObject({ unreadable: 0, complete: true });
  });

  it("names only what the caller may read, and lists the locked", async () => {
    const run = await countRemoval(
      MOBILE,
      site(
        [
          { host: entry("pages", "open"), published: page(styled("a")) },
          {
            host: entry("pages", "secret"),
            published: page(styled("a", { locked: true })),
          },
        ],
        { readable: host => host.id !== "secret" }
      )
    );
    const [mobile] = run.removed;
    expect(mobile?.documents).toEqual({ named: ["pages/open"], unnamed: 1 });
    expect(mobile?.locked).toEqual({ named: [], unnamed: 1 });
    // Counted all the same: the removal drops what it holds.
    expect(mobile?.places.pages.documents).toBe(2);
  });

  it("names readable documents past ones the caller may not read", async () => {
    // The unreadable ones come first; they must not use up the places.
    const stored: Stored[] = [
      // More than any fixed number a list could hold back to try.
      ...Array.from({ length: 5_050 }, (_, i) => ({
        host: entry("components", `c${i}`),
        published: page(styled("a")),
      })),
      { host: entry("pages", "home"), published: page(styled("a")) },
    ];
    const run = await countRemoval(
      MOBILE,
      site(stored, { readable: host => host.slug === "pages" })
    );
    expect(run.removed[0]?.documents).toEqual({
      named: ["pages/home"],
      unnamed: 5_050,
    });
  });

  it("asks the caller once for a document in both lists", async () => {
    const deps = site([
      {
        host: entry("pages", "p1"),
        published: page(styled("a", { locked: true })),
      },
    ]);
    const [mobile] = (await countRemoval(MOBILE, deps)).removed;
    expect(mobile?.documents.named).toEqual(["pages/p1"]);
    expect(mobile?.locked.named).toEqual(["pages/p1"]);
    expect(deps.named).toHaveLength(1);
  });

  it("names at most a handful, and counts the rest", async () => {
    const many: Stored[] = Array.from({ length: 120 }, (_, i) => ({
      host: entry("pages", `p${i}`),
      published: page(styled("a")),
    }));
    const deps = site(many);
    const [mobile] = (await countRemoval(MOBILE, deps)).removed;
    expect(mobile?.documents.named).toHaveLength(NAMED_AT_MOST);
    expect(mobile?.documents.unnamed).toBe(110);
    // Asked in one batch; once a list holds its names, nothing more is asked.
    expect(deps.batches).toEqual([50]);
  });

  it("asks for saved titles of exactly the documents it names, in walk order, once", async () => {
    // 15 readable pages, each renamed in a draft: the ten named first in the
    // walk are asked about in one call and shown by their saved titles.
    const pages: Stored[] = Array.from({ length: 15 }, (_, i) => ({
      host: entry("pages", `p${String(i).padStart(2, "0")}`),
      published: page(styled("a", { locked: true })),
    }));
    const deps = site(pages, { saved: host => `${host.id ?? ""} (draft)` });
    const [mobile] = (await countRemoval(MOBILE, deps)).removed;
    const firstTen = pages.slice(0, NAMED_AT_MOST).map(p => p.host);
    expect(mobile?.documents.named).toEqual(
      firstTen.map(host => `${host.id ?? ""} (draft)`)
    );
    // The locked list names the same documents, without asking again.
    expect(mobile?.locked.named).toEqual(mobile?.documents.named);
    expect(deps.savedAsks).toEqual([firstTen]);
  });

  it("reads at most twenty saved titles in one dry run, however many breakpoints go", async () => {
    // Three breakpoints, each held by ten pages of its own: thirty documents
    // would be named, and only the first twenty are read as saved.
    const at = (breakpoint: string, id: string): Stored => ({
      host: entry("pages", id),
      published: page({
        id: "a",
        type: "core/text",
        version: 1,
        props: {},
        styles: { base: { [breakpoint]: { color: "#111" } } },
      }),
    });
    const stored = ["mobile", "watch", "tv"].flatMap(breakpoint =>
      Array.from({ length: 10 }, (_, i) => at(breakpoint, `${breakpoint}-${i}`))
    );
    const deps = site(stored, { saved: host => `${host.id ?? ""} (draft)` });
    const run = await countRemoval(
      new Map([
        ["mobile", "Mobile"],
        ["watch", "Watch"],
        ["tv", "TV"],
      ]),
      deps
    );
    expect(deps.savedAsks.flat()).toHaveLength(20);
    // The third list keeps the titles the access read gave.
    expect(run.removed[2]?.documents.named[0]).toBe("pages/tv-0");
    expect(run.removed[0]?.documents.named[0]).toBe("mobile-0 (draft)");
  });

  it("spends no saved-title read on a Single, which is named by its slug", async () => {
    // Ten Singles hold Mobile, ten pages Watch and ten pages TV. The Singles
    // take nothing from the twenty reads, so both lists of pages get theirs.
    const at = (breakpoint: string, host: HostAddress): Stored => ({
      host,
      published: page({
        id: "a",
        type: "core/text",
        version: 1,
        props: {},
        styles: { base: { [breakpoint]: { color: "#111" } } },
      }),
    });
    const singles = Array.from({ length: 10 }, (_, i) =>
      at("mobile", { kind: "single", slug: `s${i}`, path: ["content"] })
    );
    const pages = ["watch", "tv"].flatMap(breakpoint =>
      Array.from({ length: 10 }, (_, i) =>
        at(breakpoint, entry("pages", `${breakpoint}-${i}`))
      )
    );
    const deps = site([...singles, ...pages], {
      saved: host => `${host.id ?? host.slug} (draft)`,
    });
    const run = await countRemoval(
      new Map([
        ["mobile", "Mobile"],
        ["watch", "Watch"],
        ["tv", "TV"],
      ]),
      deps
    );
    expect(
      deps.savedAsks.flat().every(host => host.kind === "collection")
    ).toBe(true);
    expect(run.removed[2]?.documents.named[0]).toBe("tv-0 (draft)");
  });

  it("asks once for saved titles that run out of time, and keeps the names it has", async () => {
    const deps = site([
      {
        host: entry("pages", "p1"),
        published: page(styled("a", { locked: true })),
      },
    ]);
    const asks: number[] = [];
    const run = await countRemoval(MOBILE, {
      ...deps,
      savedTitles: hosts => {
        asks.push(hosts.length);
        return new Promise(() => {});
      },
      deadline: new Date(Date.now() + 100),
    });
    // Named in both lists by the access read's title, and asked only once.
    expect(run.removed[0]?.documents.named).toEqual(["pages/p1"]);
    expect(run.removed[0]?.locked.named).toEqual(["pages/p1"]);
    expect(asks).toEqual([1]);
  });

  it("counts the whole site however slowly the caller's names come", async () => {
    // Naming waits for the walk, so it never takes time from counting: a
    // slow answer leaves documents unnamed, never uncounted.
    const deps = site(
      [
        { host: entry("pages", "p1"), published: page(styled("a")) },
        { host: entry("pages", "p2"), published: page(styled("a")) },
      ],
      { slowNames: 400 }
    );
    const run = await countRemoval(MOBILE, {
      ...deps,
      deadline: new Date(Date.now() + 150),
    });
    expect(run.complete).toBe(true);
    expect(run.removed[0]?.places.pages.documents).toBe(2);
    expect(run.removed[0]?.documents).toEqual({ named: [], unnamed: 2 });
  });

  it("counts what no write can reach as unaddressable, not in a place", async () => {
    const run = await countRemoval(
      MOBILE,
      site([
        {
          host: { ...entry("pages", "grouped"), path: ["hero", "content"] },
          access: "read",
          published: page(styled("a")),
        },
        {
          host: { ...entry("entries", "rows"), path: [] },
          access: "scan",
          published: { rows: [{ body: page(styled("a")) }] },
        },
      ])
    );
    const [mobile] = run.removed;
    expect(mobile?.unaddressable).toBe(2);
    expect(mobile?.places.pages.documents).toBe(0);
    expect(mobile?.places.entries.documents).toBe(0);
  });

  it("reports a document it could not read, and a walk its deadline stopped", async () => {
    const unread = await countRemoval(
      MOBILE,
      site([{ host: entry("pages", "p1"), unreadable: true }])
    );
    expect(unread).toMatchObject({ unreadable: 1, complete: true });

    const stopped = await countRemoval(
      MOBILE,
      site([{ host: entry("pages", "p1"), published: page(styled("a")) }], {
        deadline: new Date(Date.now() - 1),
      })
    );
    expect(stopped.complete).toBe(false);
  });

  it("takes a nested value its bounds cut off for an unreadable document", async () => {
    // Past the bounds a removed style could sit uncounted: no confident zero.
    const deps = site([
      {
        host: { ...entry("entries", "rows"), path: [] },
        access: "scan",
        published: {
          rows: [{ body: page(styled("a"), styled("b"), styled("c")) }],
        },
      },
    ]);
    const run = await countRemoval(MOBILE, {
      ...deps,
      limits: { ...DEFAULT_LIMITS, maxNodes: 2 },
    });
    expect(run).toMatchObject({ unreadable: 1, complete: true });
    expect(run.removed[0]?.unaddressable).toBe(0);
  });

  it("stops at the deadline while a read is still outstanding", async () => {
    // A read that stalls must not hold the request past its budget.
    const deps = site([
      { host: entry("pages", "p1"), published: page(styled("a")) },
    ]);
    const started = Date.now();
    const run = await countRemoval(MOBILE, {
      ...deps,
      read: () => new Promise(() => {}),
      deadline: new Date(Date.now() + 50),
    });
    expect(run.complete).toBe(false);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("counts a value read the same in every language once, where it may be one", async () => {
    const shared = page(styled("a"));
    const hosts = ["en", "fr"].map(locale => ({
      ...entry("pages", "p1"),
      locale,
    }));
    const deps = site(hosts.map(host => ({ host, published: shared })));
    const run = (maybeShared: boolean) =>
      countRemoval(MOBILE, {
        ...deps,
        documents: async function* () {
          yield {
            key: "p1",
            hosts: hosts.map(host => ({
              host,
              access: "write" as const,
              ...(maybeShared ? { maybeShared: true as const } : {}),
            })),
          };
        },
      });

    // Read per language only because its languages are unknown: one value.
    expect((await run(true)).removed[0]?.places.pages).toMatchObject({
      documents: 1,
      styles: 2,
    });
    // Known to be stored per language: each copy is dropped, each counted,
    // however alike they are.
    expect((await run(false)).removed[0]?.places.pages).toMatchObject({
      documents: 1,
      styles: 4,
    });
  });

  it("takes a document this version cannot interpret for an unreadable one", async () => {
    const run = await countRemoval(
      MOBILE,
      site([
        {
          host: entry("pages", "future"),
          published: { ...page(styled("a")), formatVersion: 999 },
        },
      ])
    );
    expect(run.unreadable).toBe(1);
    expect(run.removed[0]?.places.pages.documents).toBe(0);
  });

  it("counts the shared styles, and walks nothing when nothing is removed", async () => {
    const classes: NamedClass[] = [
      {
        id: "card",
        slug: "card",
        orderIndex: 0,
        styles: { base: { mobile: { color: "#111" } } },
        locked: true,
        label: "Card",
      },
    ];
    const run = await countRemoval(MOBILE, site([], { classes }));
    expect(run.removed[0]?.sharedStyles).toEqual({
      classes: 1,
      styles: 1,
      locked: ["Card"],
    });

    let walked = false;
    const quiet = site([{ host: entry("pages", "p1"), published: page() }]);
    const none = await countRemoval(new Map(), {
      ...quiet,
      documents: async function* () {
        walked = true;
        yield* quiet.documents();
      },
    });
    expect(none).toEqual({ removed: [], unreadable: 0, complete: true });
    expect(walked).toBe(false);
  });
});

describe("the breakpoints a new set removes", () => {
  const set = (...ids: string[]) => ({
    viewport: ids.map((id, i) => ({
      id,
      label: id.toUpperCase(),
      maxWidth: 1000 - i * 100,
    })),
    container: [],
  });

  it("names each breakpoint the new set no longer defines", () => {
    expect([
      ...removedBreakpoints(set("tablet", "mobile"), set("tablet")),
    ]).toEqual([["mobile", "MOBILE"]]);
    // Renamed, the same id: not removed.
    expect(removedBreakpoints(set("tablet"), set("tablet")).size).toBe(0);
    // The base is every site's.
    expect(removedBreakpoints(set("tablet"), set()).has("base")).toBe(false);
  });
});
