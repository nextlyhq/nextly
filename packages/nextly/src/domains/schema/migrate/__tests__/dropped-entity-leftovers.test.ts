import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { describe, expect, it } from "vitest";

import type { EntitySettingsRecord } from "../../migrate-create/entity-settings";
import {
  droppedAndUnregistered,
  recordedTablesOf,
  tablesHeldBy,
} from "../dropped-entity-leftovers";

/** A record holding the given collections, by slug, each with its settings. */
function recordOf(
  collections: Record<string, Record<string, string>>
): EntitySettingsRecord {
  return {
    collections: Object.fromEntries(
      Object.entries(collections).map(([slug, settings]) => [
        slug,
        { source: "builder" as const, settings },
      ])
    ),
    singles: {},
    fieldGroups: {},
  };
}

describe("the tables a dropped entity was recorded with", () => {
  it("names every one an entity of the same slug was made with along the history, newest first", () => {
    // `notes` made, deleted, made again under another table, and deleted again.
    const chain = [
      recordOf({ notes: { dbName: "dc_notes_first" } }),
      recordOf({}),
      recordOf({ notes: { dbName: "dc_notes_second" } }),
      recordOf({ notes: { dbName: "dc_notes_second" } }),
      recordOf({}),
    ];
    expect(recordedTablesOf(chain, "collection", "notes")).toEqual([
      "dc_notes_second",
      "dc_notes_first",
    ]);
    // Another kind under the same slug is another entity.
    expect(recordedTablesOf(chain, "single", "notes")).toEqual([]);
  });

  it("holds every table the newest record's entities name, whoever named it before", () => {
    // `posts` now uses the table `notes` was dropped with.
    const newest = recordOf({
      posts: { dbName: "dc_notes" },
      pages: {},
    });
    expect([...tablesHeldBy(newest)].sort()).toEqual(["dc_notes", "dc_pages"]);
  });
});

describe("a dropped collection or Single nothing is registered under", () => {
  /** A database whose registries hold `held`, by table; one that is undefined cannot be read. */
  const holding = (held: Record<string, string[] | undefined>) =>
    ({
      tableExists: async () => true,
      select: async (
        table: string,
        { where }: { where: { and: { value: string }[] } }
      ) => {
        const slugs = held[table];
        if (slugs === undefined) throw new Error("unreadable");
        return slugs
          .filter(slug => slug === where.and[0].value)
          .map(slug => ({ slug }));
      },
    }) as unknown as DrizzleAdapter;
  const chain = [recordOf({ notes: {}, users: {} }), recordOf({})];
  const goneIn = async (held: Record<string, string[] | undefined>) => [
    ...(await droppedAndUnregistered({ adapter: holding(held), chain }))
      .collection,
  ];

  it("is named, Nextly's own resources never", async () => {
    expect(
      await goneIn({ dynamic_collections: [], dynamic_singles: [] })
    ).toEqual(["notes"]);
  });

  it.each([
    [
      "a collection is",
      { dynamic_collections: ["notes"], dynamic_singles: [] },
    ],
    ["a Single is", { dynamic_collections: [], dynamic_singles: ["notes"] }],
    [
      "the registry cannot be read",
      { dynamic_collections: undefined, dynamic_singles: [] },
    ],
  ])("is not where %s", async (_where, held) => {
    expect(await goneIn(held)).toEqual([]);
  });
});
