/**
 * A field removed in the Schema Builder takes its column with it, on every dialect.
 *
 * The Builder's ALTER generator wrote `DROP COLUMN IF EXISTS`, which MySQL does not accept (MariaDB
 * does), so on MySQL a removed field's column stayed and a Required one refused every later entry.
 * Collections and Singles share the generator; each is driven through its own save.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): {
    createEntry(
      params: { collectionName: string; overrideAccess?: boolean },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; message?: string }>;
  };
}

async function columnsOf(
  current: TestNextly,
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  const query =
    dialect === "mysql"
      ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
      : dialect === "sqlite"
        ? `SELECT name FROM pragma_table_info('${table}')`
        : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`;
  const rows = await (
    current.adapter as unknown as {
      executeQuery<R>(sql: string): Promise<R[]>;
    }
  ).executeQuery<{ name: string }>(query);
  return rows.map(row => row.name);
}

describeEachDialect("a field removed in the Schema Builder", dialect => {
  let current: TestNextly;

  beforeEach(async () => {
    // The Builder's save runs its migration in development only.
    vi.stubEnv("NODE_ENV", "development");
    current = await createTestNextly({ dialect, collections: [] });
  });

  afterEach(async () => {
    await current.destroy();
    vi.unstubAllEnvs();
  });

  const handler = () =>
    current.getService("collectionsHandler") as unknown as CollectionsHandler;

  it("takes its column from a collection, and later entries are accepted", async () => {
    const created = await handler().createCollection({
      name: "notes",
      label: "Note",
      fields: [
        { name: "note", type: "text", required: true },
        { name: "aside", type: "text" },
        { name: "views", type: "number" },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const first = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: "notes", overrideAccess: true },
        { note: "Kept", aside: "Also", views: 1 }
      );
    expect(first.success, JSON.stringify(first)).toBe(true);

    const saved = await handler().updateCollection(
      { collectionName: "notes" },
      { fields: [{ name: "views", type: "number" }] }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    const columns = await columnsOf(current, dialect, "dc_notes");
    expect(columns).not.toContain("note");
    expect(columns).not.toContain("aside");
    const later = await handler()
      .getEntryService()
      .createEntry(
        { collectionName: "notes", overrideAccess: true },
        { views: 2 }
      );
    expect(later.success, JSON.stringify(later)).toBe(true);
  });

  it("leaves alone a column no field describes, as an install left it", async () => {
    // A MySQL install keeps the columns of fields it removed before this was fixed, with their
    // data. A save drops only the columns of the fields it removes, so those stay until someone
    // removes them on purpose.
    const created = await handler().createCollection({
      name: "notes",
      label: "Note",
      fields: [
        { name: "aside", type: "text" },
        { name: "views", type: "number" },
      ],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    const quote = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    await (
      current.adapter as unknown as {
        executeQuery(sql: string): Promise<unknown>;
      }
    ).executeQuery(
      `ALTER TABLE ${quote("dc_notes")} ADD COLUMN ${quote("legacy_note")} TEXT`
    );

    const saved = await handler().updateCollection(
      { collectionName: "notes" },
      { fields: [{ name: "views", type: "number" }] }
    );
    expect(saved.success, JSON.stringify(saved)).toBe(true);

    const columns = await columnsOf(current, dialect, "dc_notes");
    expect(columns).not.toContain("aside");
    expect(columns).toContain("legacy_note");
  });

  it("takes its column from a Single, and later writes are accepted", async () => {
    await dispatchSingles(
      "createSingle",
      {},
      {
        slug: "banner",
        label: "Banner",
        fields: [
          { name: "headline", type: "text", required: true },
          { name: "views", type: "number" },
        ],
      }
    );
    const singles: SingleEntryService =
      current.getService("singleEntryService");
    const first = await singles.update(
      "banner",
      { headline: "Kept", views: 1 },
      { overrideAccess: true }
    );
    expect(first.success, JSON.stringify(first)).toBe(true);

    await dispatchSingles(
      "updateSingleSchema",
      { slug: "banner" },
      { fields: [{ name: "views", type: "number" }] }
    );

    expect(await columnsOf(current, dialect, "single_banner")).not.toContain(
      "headline"
    );
    const later = await singles.update(
      "banner",
      { views: 2 },
      { overrideAccess: true }
    );
    expect(later.success, JSON.stringify(later)).toBe(true);
  });
});
