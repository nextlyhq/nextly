/**
 * A relationship's `required`, changed in the Schema Builder, reaches its column on every dialect:
 * turned on, the column is NOT NULL; turned off, nullable again. Turned on while an entry has no
 * value in it, the save is refused with the message any other field gets, naming the field and how
 * many entries, and the column is left as it was.
 *
 * The save asks whether the column becomes NOT NULL from the column descriptor, which called a
 * relationship's column nullable whatever `required` said. So the refusal never ran for one, and
 * the NOT NULL the save went on to write failed in the database instead.
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
    ): Promise<{ success: boolean; message?: string; data?: unknown }>;
  };
}

const HEADING = { name: "heading", type: "text" };
const author = (required: boolean) => ({
  name: "author",
  type: "relationship",
  relationTo: "writers",
  ...(required ? { required: true } : {}),
});

async function authorIsNotNull(
  current: TestNextly,
  dialect: TestDialect
): Promise<boolean> {
  const query =
    dialect === "sqlite"
      ? `SELECT "notnull" AS required FROM pragma_table_info('dc_notes') WHERE name = 'author'`
      : dialect === "mysql"
        ? `SELECT IF(IS_NULLABLE = 'NO', 1, 0) AS required FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'dc_notes' AND COLUMN_NAME = 'author'`
        : `SELECT CASE WHEN is_nullable = 'NO' THEN 1 ELSE 0 END AS required FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'dc_notes' AND column_name = 'author'`;
  const [row] = await (
    current.adapter as unknown as {
      executeQuery<R>(sql: string): Promise<R[]>;
    }
  ).executeQuery<{ required: number | string }>(query);
  return Number(row?.required) === 1;
}

describeEachDialect(
  "a relationship's required, changed in the Schema Builder",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The Builder's save runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [] });
      const writers = await handler().createCollection({
        name: "writers",
        label: "Writer",
        fields: [{ name: "name", type: "text" }],
      });
      expect(writers.success, JSON.stringify(writers)).toBe(true);
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const handler = () =>
      current.getService("collectionsHandler") as unknown as CollectionsHandler;

    async function createNotes(required: boolean): Promise<void> {
      const created = await handler().createCollection({
        name: "notes",
        label: "Note",
        fields: [HEADING, author(required)],
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
    }

    function save(required: boolean) {
      return handler().updateCollection(
        { collectionName: "notes" },
        { fields: [HEADING, author(required)] }
      );
    }

    it("makes the column NOT NULL when the relationship becomes required, and nullable when it stops", async () => {
      await createNotes(false);
      expect(await authorIsNotNull(current, dialect)).toBe(false);

      const on = await save(true);
      expect(on.success, JSON.stringify(on)).toBe(true);
      expect(await authorIsNotNull(current, dialect)).toBe(true);

      const off = await save(false);
      expect(off.success, JSON.stringify(off)).toBe(true);
      expect(await authorIsNotNull(current, dialect)).toBe(false);
    });

    it("refuses to make it required while an entry has no value in it, naming the field, and leaves the column", async () => {
      await createNotes(false);
      const entry = await handler()
        .getEntryService()
        .createEntry(
          { collectionName: "notes", overrideAccess: true },
          { heading: "No author" }
        );
      expect(entry.success, JSON.stringify(entry)).toBe(true);

      const refused = await save(true).then(
        result => result,
        (error: unknown) => error
      );

      // Refused whichever way the handler reports it: a failed result, or the error it throws.
      const told =
        refused instanceof Error
          ? `${refused.message} ${JSON.stringify((refused as { publicData?: unknown }).publicData ?? null)}`
          : JSON.stringify(refused);
      expect(
        refused instanceof Error ||
          (refused as { success?: boolean }).success === false
      ).toBe(true);
      expect(told).toContain("REQUIRED_COLUMN_HAS_NULLS");
      expect(told).toContain(
        "field 'author' cannot become required while 1 row holds no value in it"
      );
      expect(await authorIsNotNull(current, dialect)).toBe(false);
    });
  }
);
