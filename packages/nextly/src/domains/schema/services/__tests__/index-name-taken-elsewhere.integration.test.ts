/**
 * A unique field's index name taken by an index the collection's own table doesn't hold. On SQLite
 * an index name is unique across the whole database and compared without regard to case, and on
 * PostgreSQL an index shares its name space with every relation in the schema: an index under the
 * name on another table, or under the same name in other letter case on SQLite, makes the save's
 * `CREATE UNIQUE INDEX IF NOT EXISTS` do nothing. The save is refused before anything changes,
 * naming the index, rather than recorded unique with nothing enforcing it. MySQL names an index per
 * table, so nothing elsewhere can take the name there.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { uniqueIndexNameForColumn } from "../index-name";

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

describeEachDialect(
  "a unique field whose index name is taken elsewhere",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [] });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const handler = () =>
      current.getService("collectionsHandler") as unknown as CollectionsHandler;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "sqlite"
          ? `SELECT name FROM pragma_table_info('${table}')`
          : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    /** A collection with a text `heading` and one entry per heading. */
    async function collectionWith(
      name: string,
      headings: string[]
    ): Promise<void> {
      const created = await handler().createCollection({
        name,
        label: name,
        fields: [{ name: "heading", type: "text" }],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      for (const heading of headings) {
        const entry = await handler()
          .getEntryService()
          .createEntry(
            { collectionName: name, overrideAccess: true },
            { heading }
          );
        expect(entry.success, JSON.stringify(entry)).toBe(true);
      }
    }

    const withUniqueCode = [
      { name: "heading", type: "text" },
      // Short, as the other dialects' indexes need.
      {
        name: "code",
        type: "text",
        unique: true,
        options: { variant: "short" },
        validation: { maxLength: 64 },
      },
    ];

    it.skipIf(dialect === "mysql")(
      "refuses a unique field whose index name an index on another table holds, and saves once it is gone",
      async () => {
        await collectionWith("posts", ["One", "Two"]);
        await collectionWith("notes", ["Note"]);
        const blocking = uniqueIndexNameForColumn("dc_posts", "code");
        await query(
          `CREATE INDEX ${q(blocking)} ON ${q("dc_notes")} (${q("id")})`
        );

        const refused = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: withUniqueCode }
        );

        expect(refused.success, JSON.stringify(refused)).toBe(false);
        expect(JSON.stringify(refused)).toContain(blocking);
        expect(await columnsOf("dc_posts")).not.toContain("code");

        // Once the name is free, the field is saved, and its index enforces it.
        await query(`DROP INDEX ${q(blocking)}`);
        const saved = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: withUniqueCode }
        );
        expect(saved.success, JSON.stringify(saved)).toBe(true);
        const entries = handler().getEntryService();
        const first = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "Three", code: "same" }
        );
        expect(first.success, JSON.stringify(first)).toBe(true);
        const second = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "Four", code: "same" }
        );
        expect(second.success, JSON.stringify(second)).toBe(false);
      }
    );

    // PostgreSQL's quoted names are case-sensitive, so another case is another name there.
    it.skipIf(dialect !== "sqlite")(
      "refuses a unique field whose index name an index holds in other letter case",
      async () => {
        await collectionWith("posts", ["One", "Two"]);
        const blocking = uniqueIndexNameForColumn(
          "dc_posts",
          "code"
        ).toUpperCase();
        await query(
          `CREATE INDEX ${q(blocking)} ON ${q("dc_posts")} (${q("id")})`
        );

        const refused = await handler().updateCollection(
          { collectionName: "posts" },
          { fields: withUniqueCode }
        );

        expect(refused.success, JSON.stringify(refused)).toBe(false);
        expect(JSON.stringify(refused)).toContain(blocking);
        expect(await columnsOf("dc_posts")).not.toContain("code");
      }
    );
  }
);
