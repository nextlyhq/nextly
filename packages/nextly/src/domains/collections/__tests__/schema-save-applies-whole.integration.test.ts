/**
 * A Schema Builder save applies whole or fails whole, and says why.
 *
 * A new Required, Unique field on a collection that already has entries gives every existing entry
 * the same placeholder, so the unique index cannot be built. The save used to report "applied
 * successfully" over that failure: the column was there, the index was not, and the registry
 * recorded the field as unique. It now fails with the database's reason, the table keeps its shape,
 * and the registry keeps the fields it had.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

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

describeEachDialect("a schema save whose migration fails", dialect => {
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

  async function query<T>(sql: string): Promise<T[]> {
    return (
      current.adapter as unknown as {
        executeQuery<R>(statement: string): Promise<R[]>;
      }
    ).executeQuery<T>(sql);
  }

  async function columnsOf(table: string): Promise<string[]> {
    const rows = await query<{ name: string }>(
      dialect === "mysql"
        ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
        : dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
    );
    return rows.map(row => row.name);
  }

  async function registeredFields(slug: string): Promise<string[]> {
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const [row] = await query<{ fields: unknown }>(
      `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = '${slug}'`
    );
    const fields = (
      typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
    ) as { name: string }[];
    return fields.map(f => f.name);
  }

  it("fails with the reason, and leaves the table and the registry as they were", async () => {
    const created = await handler().createCollection({
      name: "posts",
      label: "Post",
      fields: [{ name: "heading", type: "text" }],
    });
    expect(created.success, JSON.stringify(created)).toBe(true);
    for (const heading of ["One", "Two"]) {
      const entry = await handler()
        .getEntryService()
        .createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading }
        );
      expect(entry.success, JSON.stringify(entry)).toBe(true);
    }
    const fieldsBefore = await registeredFields("posts");

    const saved = await handler().updateCollection(
      { collectionName: "posts" },
      {
        fields: [
          { name: "heading", type: "text" },
          {
            name: "code",
            type: "text",
            length: 64,
            required: true,
            unique: true,
          },
        ],
      }
    );

    expect(saved.success, JSON.stringify(saved)).toBe(false);
    expect(await columnsOf("dc_posts")).not.toContain("code");
    expect(await registeredFields("posts")).toEqual(fieldsBefore);
  });
});
