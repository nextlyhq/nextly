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
import { fieldTypeChangesOf } from "../field-type-changes";
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
    const result = await judgeStoredTypeChange({
      db: current.adapter.getDrizzle(),
      dialect,
      table: "dc_events",
      column: "at",
      keyedBy: "id",
      from: change.fromType,
      to: change.toType,
      onReading: (_key, reading) => readsAs.push(reading),
    });

    expect(result.judgement.class).not.toBe("blocked");
    expect(readsAs).toEqual([
      expect.stringMatching(/^2024-01-02T03:04:05(\.0+)?Z$/),
    ]);
  }, 120_000);
});
