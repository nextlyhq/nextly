/**
 * A date as the app writes it is read back as the instant it names, on every database: a type
 * change judged over a date column reads each value in UTC, whatever the database keeps (SQLite's
 * seconds since 1970, PostgreSQL's and MySQL's `YYYY-MM-DD HH:MM:SS`, which names no offset). Read
 * through the real entry write, so the test holds whatever spelling each dialect's writer uses.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../../plugins/test-nextly";
import type { FieldDefinition } from "../../../../../schemas/dynamic-collections";
import {
  fieldTypeChangesOf,
  judgeFieldTypeChanges,
} from "../field-type-changes";
import { judgeStoredTypeChange } from "../judge-stored";

interface CollectionsHandler {
  createCollection(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): {
    createEntry(
      params: { collectionName: string; overrideAccess?: boolean },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; message?: string }>;
  };
}

describeEachDialect("a stored date read for a type change", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current?.destroy();
    vi.unstubAllEnvs();
  });

  it("reads the instant the app wrote, in UTC", async () => {
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const created = await handler.createCollection({
      name: "events",
      label: "Event",
      fields: [{ name: "at", type: "date" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entry = await handler
      .getEntryService()
      .createEntry(
        { collectionName: "events", overrideAccess: true },
        { title: "E", at: "2024-01-02T03:04:05.000Z" }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);

    const changes = fieldTypeChangesOf({
      previous: [{ name: "at", type: "date" }] as FieldDefinition[],
      next: [{ name: "at", type: "text" }] as FieldDefinition[],
      dialect,
      builtBy: "collection",
    });
    const [change] = changes;
    if (change === undefined) throw new Error("no type change found");
    const readsAs: string[] = [];
    // Only the reading is asked here: a date read as text is a new form no save writes yet.
    await judgeStoredTypeChange({
      db: current.adapter.getDrizzle(),
      dialect,
      table: "dc_events",
      column: "at",
      keyedBy: "id",
      from: change.fromType,
      to: change.toType,
      onReading: (_key, reading) => readsAs.push(reading),
    });

    expect(readsAs).toEqual([
      expect.stringMatching(/^2024-01-02T03:04:05(\.0+)?Z$/),
    ]);
  }, 120_000);

  it("reads a value from the table that holds its column, when the save also turns translation on", async () => {
    // The desired definition says the field is translated, so its companion is asked first; the
    // companion does not exist yet, and the value is still on the main table, where it is judged.
    const handler = current.getService(
      "collectionsHandler"
    ) as unknown as CollectionsHandler;
    const created = await handler.createCollection({
      name: "items",
      label: "Item",
      fields: [{ name: "score", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const entry = await handler
      .getEntryService()
      .createEntry(
        { collectionName: "items", overrideAccess: true },
        { title: "I", score: "xyz" }
      );
    expect(entry.success, JSON.stringify(entry)).toBe(true);

    const judged = await judgeFieldTypeChanges({
      db: current.adapter.getDrizzle(),
      dialect,
      builtBy: "collection",
      table: "dc_items",
      translationsTable: "dc_items_locales",
      translated: new Set(["score"]),
      changes: fieldTypeChangesOf({
        previous: [{ name: "score", type: "text" }] as FieldDefinition[],
        next: [{ name: "score", type: "number" }] as FieldDefinition[],
        dialect,
        builtBy: "collection",
      }),
    });

    expect(judged.map(j => [j.table, j.result.judgement.class])).toEqual([
      ["dc_items", "lossy"],
    ]);
  }, 120_000);
});
