import { describe, expect, it } from "vitest";

import type { EntitySettingsRecord } from "../../migrate-create/entity-settings";
import { recordedTablesOf, tablesHeldBy } from "../dropped-entity-leftovers";

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
