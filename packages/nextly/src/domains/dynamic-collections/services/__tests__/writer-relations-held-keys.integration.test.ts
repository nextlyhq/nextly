/**
 * The relationship keys a Builder save writes into its migration file, read from the keys the
 * table really holds.
 *
 * Which keys a Builder table holds depends on its history, so the save reads them from the
 * database: the drop it writes names the key the table has, a kept key keeps the target the
 * database records whatever its field reads now, a translated relationship (whose column lives on
 * the companion table) gets no key on the main table, and collections deleted together are ordered
 * by the keys the database reports.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import { DynamicCollectionService } from "../dynamic-collection-service";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
}

const relationship = (
  name: string,
  extra: Record<string, unknown>
): FieldDefinition =>
  ({ name, type: "relationship", ...extra }) as unknown as FieldDefinition;

describeEachDialect("a Builder save's relationship keys", dialect => {
  let current: TestNextly;
  let service: DynamicCollectionService;

  beforeEach(async () => {
    // The Builder applies a collection's creation in development.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
    service = new DynamicCollectionService(current.adapter, {
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    } as never);
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    for (const collection of [
      {
        name: "authors",
        label: "Author",
        fields: [{ name: "name", type: "text" }],
      },
      {
        name: "editors",
        label: "Editor",
        fields: [{ name: "name", type: "text" }],
      },
      {
        name: "notes",
        label: "Note",
        fields: [
          { name: "title", type: "text" },
          relationship("author", {
            options: { target: "authors", relationType: "manyToOne" },
          }),
        ],
      },
    ]) {
      const created = await handler.createCollection(collection);
      expect(created.success, JSON.stringify(created)).toBe(true);
    }
  });

  afterEach(async () => {
    vi.unstubAllEnvs();
    await current?.destroy();
  });

  const recorded = [
    { name: "title", type: "text" } as FieldDefinition,
    relationship("author", {
      options: { target: "authors", relationType: "manyToOne" },
    }),
  ];

  it("reads the keys a table holds from the database", async () => {
    expect(
      (await service.heldRelationshipKeys("dc_notes")).map(key => ({
        columns: key.columns,
        referencesTable: key.referencesTable,
      }))
    ).toEqual([{ columns: ["author"], referencesTable: "dc_authors" }]);
  });

  it("keeps a held key's target when its field reads another collection", async () => {
    // Recorded so already: `relationTo`, which reads follow, names the editors, while the database
    // still checks authors. A save that does not change it leaves the key where it is.
    const mismatched = [
      recorded[0],
      relationship("author", {
        relationTo: "editors",
        options: { target: "authors", relationType: "manyToOne" },
      }),
    ];
    const { keys } = await service.writerRelations(
      "dc_notes",
      mismatched,
      mismatched
    );
    expect(keys.after.map(key => key.referencesTable)).toEqual(["dc_authors"]);
    expect(keys.before.map(key => key.referencesTable)).toEqual(["dc_authors"]);
  });

  it("moves a held key with a save that points its relationship elsewhere", async () => {
    const { keys } = await service.writerRelations("dc_notes", recorded, [
      recorded[0],
      relationship("author", {
        options: { target: "editors", relationType: "manyToOne" },
      }),
    ]);
    expect(keys.before.map(key => [key.name, key.referencesTable])).toEqual([
      ["fk_dc_notes_author", "dc_authors"],
    ]);
    // Under a name of its own, so the file adds it before dropping the old one.
    expect(keys.after.map(key => [key.name, key.referencesTable])).toEqual([
      ["fk_dc_notes_author_to_dc_editors", "dc_editors"],
    ]);
  });

  it("gives a translated relationship no key on the main table", async () => {
    const { keys } = await service.writerRelations("dc_notes", recorded, [
      ...recorded,
      relationship("reviewer", { relationTo: "editors", localized: true }),
    ]);
    expect(keys.after.flatMap(key => key.columns)).toEqual(["author"]);
  });

  it("keys a relationship the save adds on the main table", async () => {
    const { keys } = await service.writerRelations("dc_notes", recorded, [
      ...recorded,
      relationship("reviewer", { relationTo: "editors" }),
    ]);
    expect(
      keys.after.map(key => [key.columns[0], key.referencesTable])
    ).toEqual([
      ["author", "dc_authors"],
      ["reviewer", "dc_editors"],
    ]);
  });
});
