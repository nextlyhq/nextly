/**
 * Which languages the walk reads each host in: a top-level field by its own
 * classification, anything deeper in every configured language, because core
 * stores a localized field group's values per language under a parent that is
 * not translated.
 */
import { describe, expect, it, vi } from "vitest";

import { NextlyError } from "@nextlyhq/plugin-sdk";

/** The conditional writes the writer made, and a failure for the next one. */
const stored = vi.hoisted(() => ({
  writes: [] as { data: Record<string, unknown> }[],
  failNext: undefined as unknown,
}));

// The stored read and the conditional write are core's, which a unit test
// does not boot: the read answers every field as stored, an empty document,
// on a live row with no public state and no pending draft, and the write is
// recorded, or fails as the test says.
vi.mock("@nextlyhq/plugin-sdk", async importOriginal => ({
  ...(await importOriginal<Record<string, unknown>>()),
  readStoredFields: async (
    _identity: unknown,
    request: { fields: readonly string[] }
  ) => ({
    kind: "found",
    values: Object.fromEntries(
      request.fields.map(name => [
        name,
        { kind: "value", value: { nodes: [] } },
      ])
    ),
    live: { publicState: null, workingDraft: false },
  }),
  updateIfUnchanged: async (
    _identity: unknown,
    update: { data: Record<string, unknown> }
  ) => {
    const failure = stored.failNext;
    stored.failNext = undefined;
    if (failure !== undefined) throw failure;
    stored.writes.push(update);
  },
}));

import {
  singleToWalk,
  siteHostReader,
  siteHostSource,
  siteHostWriter,
  type RewriteSite,
  type SingleToWalk,
} from "./site";

/** A site with one collection, `notes`, holding one entry, `n1`, and these Singles. */
function siteWith(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): RewriteSite {
  const nextly = {
    find: async () => ({ items: [{ id: "n1" }], meta: { hasNext: false } }),
  };
  return {
    nextly: async () => nextly as never,
    collectionSlugs: async () => ["notes"],
    resolveCollection: async () => declaration,
    singles: async () => singles,
    locales: () => ["en", "de"],
    defaultLocale: () => "en",
    layouts: "layouts",
    hints: async () => [],
    componentId: "card",
    identity: async () => ({ user: { id: "u1" } }),
  };
}

/** Every host the walk yields, as `path@locale`. */
async function hostsOf(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): Promise<string[]> {
  const found: string[] = [];
  const source = siteHostSource(siteWith(declaration, singles));
  for await (const document of source.documents(null)) {
    for (const { host } of document.hosts) {
      found.push(`${host.path.join(".") || "*"}@${host.locale ?? "-"}`);
    }
  }
  return found;
}

/** Every host the walk yields, as `path@locale`, marked `~` where it may be one stored value. */
async function sharedness(
  declaration: unknown,
  singles: readonly SingleToWalk[] = []
): Promise<string[]> {
  const found: string[] = [];
  const source = siteHostSource(siteWith(declaration, singles));
  for await (const document of source.documents(null)) {
    for (const { host, maybeShared } of document.hosts) {
      found.push(
        `${host.path.join(".") || "*"}@${host.locale ?? "-"}${maybeShared === true ? "~" : ""}`
      );
    }
  }
  return found;
}

describe("which hosts may read one stored value in every language", () => {
  it("knows a translated top-level field is stored per language", async () => {
    const hosts = await sharedness({
      localized: true,
      fields: [{ type: "blocks", name: "content", localized: true }],
    });
    expect(hosts).toEqual(["content@en", "content@de"]);
  });

  it("marks what is read per language only because it is unknown", async () => {
    // A Single made in the admin: its fields' own flags are unknown.
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      undefined,
      true
    );
    expect(await sharedness({ fields: [] }, [home])).toEqual([
      "content@en~",
      "content@de~",
    ]);
    // A field under a named group, and a scan of the row.
    expect(
      await sharedness({
        fields: [
          {
            type: "group",
            name: "hero",
            fields: [{ type: "blocks", name: "body" }],
          },
          { type: "fieldGroup", name: "more", group: "more-group" },
        ],
      })
    ).toEqual(["hero.body@en~", "hero.body@de~", "*@en~", "*@de~"]);
  });
});

describe("the languages each host is read in", () => {
  it("reads a field behind a field group in every language of an untranslated parent", async () => {
    const hosts = await hostsOf({
      fields: [
        { type: "text", name: "title" },
        { type: "fieldGroup", name: "hero", group: "hero-group" },
      ],
    });

    expect(hosts).toEqual(["*@en", "*@de"]);
  });

  it("reads a field under a named group in every language", async () => {
    const hosts = await hostsOf({
      fields: [
        {
          type: "group",
          name: "hero",
          fields: [{ type: "blocks", name: "body" }],
        },
      ],
    });

    expect(hosts).toEqual(["hero.body@en", "hero.body@de"]);
  });

  it("CONTROL: reads an untranslated top-level field once", async () => {
    const hosts = await hostsOf({
      fields: [{ type: "blocks", name: "content" }],
    });

    expect(hosts).toEqual(["content@-"]);
  });

  it("reads every field of a Single made in the admin in every language", async () => {
    // Listed with no declaration in code: its fields' own flags are unknown.
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      undefined,
      true
    );

    const hosts = await hostsOf({ fields: [] }, [home]);

    expect(hosts).toEqual(["content@en", "content@de"]);
  });

  it("CONTROL: a Single declared in code keeps its fields' own flags", async () => {
    const home = singleToWalk(
      { slug: "home", fields: [{ type: "blocks", name: "content" }] },
      {
        localized: true,
        fields: [{ type: "blocks", name: "content", localized: false }],
      },
      true
    );

    const hosts = await hostsOf({ fields: [] }, [home]);

    expect(hosts).toEqual(["content@-"]);
  });

  it("skips a hint naming a collection that no longer resolves", async () => {
    const site = siteWith({ fields: [{ type: "blocks", name: "content" }] });
    const hinted = await siteHostSource({
      ...site,
      hints: async () => [
        { slug: "gone", id: "x" },
        { slug: "notes", id: "n1" },
      ],
      resolveCollection: async slug => {
        if (slug === "gone") throw new Error("no such collection");
        return { fields: [{ type: "blocks", name: "content" }] };
      },
    }).hinted();

    expect(hinted.map(document => document.key)).toEqual([
      "collection\u001Fnotes\u001Fn1",
    ]);
  });

  it("leaves the fields the walk reaches directly out of a row scan", async () => {
    const source = siteHostSource(
      siteWith({
        fields: [
          { type: "blocks", name: "content" },
          {
            type: "repeater",
            name: "rows",
            fields: [{ type: "blocks", name: "body" }],
          },
        ],
      })
    );
    const scans: unknown[] = [];
    for await (const document of source.documents(null)) {
      for (const candidate of document.hosts) {
        if (candidate.access === "scan") scans.push(candidate.excluded);
      }
    }

    expect(scans).toEqual([[["content"]], [["content"]]]);
  });
});

describe("the version a host write sends", () => {
  // A rewrite's write is made from its read of the host, so it sends that
  // read's version: a save of the row in between refuses it, and the run
  // reports the host as changed rather than overwriting the save.
  const host = {
    kind: "collection" as const,
    slug: "notes",
    id: "n1",
    path: ["content"],
  };

  function siteOver(nextly: Record<string, unknown>): RewriteSite {
    return {
      ...siteWith({ fields: [] }),
      nextly: async () => nextly as never,
    };
  }

  it("reads the live row's version", async () => {
    const read = await siteHostReader(
      siteOver({
        findByID: async () => ({ id: "n1", content: { nodes: [] }, _rev: "7" }),
      })
    )(host);
    expect(read.rev).toBe("7");
  });

  it("writes with the version the host was read at", async () => {
    stored.writes.length = 0;
    const writer = siteHostWriter(siteOver({}));
    const result = await writer({
      host,
      value: { nodes: [] },
      mode: "save",
      expected: { form: "published", hash: "h" },
      rev: "7",
    });
    expect(result).toEqual({ kind: "written" });
    expect(stored.writes.map(write => write.data)).toEqual([
      { content: { nodes: [] }, _rev: "7" },
    ]);
  });

  it("reports a write refused as made from an out-of-date version as changed", async () => {
    stored.failNext = new NextlyError({
      code: "STALE_VERSION",
      publicMessage: "This document changed since the version you gave.",
    });
    const writer = siteHostWriter(siteOver({}));
    const result = await writer({
      host,
      value: { nodes: [] },
      mode: "save",
      expected: { form: "published", hash: "h" },
      rev: "7",
    });
    expect(result).toEqual({ kind: "changed" });
  });
});
