/**
 * A code-first collection's `dbName` changed onto a table that is already there, or whose table
 * rename the database refuses, is refused: the registry keeps naming the old table, the refusal
 * names both tables, and the code-first sync reports it rather than passing over it.
 *
 * The sync moves a collection to the table its configuration names by renaming the old table. When
 * a table of the new name is already there, the rename cannot be made without losing one of the
 * two, and when the database refuses the rename (or the tables cannot be read to decide), the old
 * table still holds the rows. In each case the registry must keep naming the old table: recording
 * the new one would serve the collection from a table that does not hold its entries.
 *
 * The control: with no table of the new name there, the sync renames the table and the registry
 * follows it.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { defineCollection, text } from "../../../config";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type {
  CodeFirstCollectionConfig,
  CollectionRegistryService,
} from "../services/collection-registry-service";

const NOTES = defineCollection({
  slug: "notes",
  fields: [text({ name: "title" })],
});

/** The table the configuration moves the collection to. */
const MOVED = "dc_notes_moved";

describeEachDialect(
  "a code-first dbName onto a table that is there",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      current = await createTestNextly({ dialect, collections: [NOTES] });
      const created = await current.nextly.create({
        collection: "notes",
        data: { title: "Kept" },
      });
      expect(created.item).toMatchObject({ title: "Kept" });
    });

    afterEach(async () => {
      await current.destroy();
      vi.restoreAllMocks();
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    function registry(): CollectionRegistryService {
      return current.getService(
        "collectionRegistryService"
      ) as unknown as CollectionRegistryService;
    }

    /** The table the registry names for `notes`. */
    async function registeredTable(): Promise<string | undefined> {
      return (await registry().getCollectionBySlug("notes"))?.tableName;
    }

    /** `notes` as the configuration now declares it: its own fields, under `dbName`'s table. */
    async function movedConfig(): Promise<CodeFirstCollectionConfig> {
      const existing = await registry().getCollectionBySlug("notes");
      if (!existing) throw new Error("notes is not registered");
      return {
        slug: "notes",
        labels: existing.labels as CodeFirstCollectionConfig["labels"],
        fields: existing.fields,
        tableName: MOVED,
        source: "code",
      };
    }

    /** The titles a table holds. */
    async function titlesIn(table: string): Promise<string[]> {
      const rows = await query<{ title: string }>(
        `SELECT ${q("title")} AS title FROM ${q(table)}`
      );
      return rows.map(row => row.title);
    }

    /** Assert the sync refused the move, naming both tables, and left everything where it was. */
    async function expectRefused(
      result: Awaited<
        ReturnType<CollectionRegistryService["syncCodeFirstCollections"]>
      >
    ): Promise<void> {
      expect(result.updated).not.toContain("notes");
      expect(result.unchanged).not.toContain("notes");
      expect(result.errors).toEqual([
        {
          slug: "notes",
          error: expect.stringMatching(
            /TABLE_RENAME_REFUSED|'dc_notes'.*'dc_notes_moved'/
          ),
        },
      ]);
      expect(result.errors[0]?.error).toContain("'dc_notes'");
      expect(result.errors[0]?.error).toContain("'dc_notes_moved'");
      expect(await registeredTable()).toBe("dc_notes");
      expect(await titlesIn("dc_notes")).toEqual(["Kept"]);
    }

    it("refuses a dbName onto a table that is already there, keeping the old table", async () => {
      await query(`CREATE TABLE ${q(MOVED)} (${q("id")} VARCHAR(36))`);

      const result = await registry().syncCodeFirstCollections([
        await movedConfig(),
      ]);

      await expectRefused(result);
      expect(await current.adapter.tableExists(MOVED)).toBe(true);
    });

    it("refuses a dbName whose table rename the database refuses, keeping the old table", async () => {
      const adapter = current.adapter as unknown as {
        executeQuery: (sql: string, ...rest: unknown[]) => Promise<unknown>;
      };
      const real = adapter.executeQuery.bind(adapter);
      vi.spyOn(adapter, "executeQuery").mockImplementation(
        async (sql: string, ...rest: unknown[]) => {
          if (/RENAME\s+TO/i.test(sql)) {
            throw new Error("the database refused the rename");
          }
          return real(sql, ...rest);
        }
      );

      const result = await registry().syncCodeFirstCollections([
        await movedConfig(),
      ]);

      await expectRefused(result);
      expect(await current.adapter.tableExists(MOVED)).toBe(false);
    });

    it("refuses a dbName when the tables cannot be read to decide, keeping the old table", async () => {
      const config = await movedConfig();
      const adapter = current.adapter as unknown as {
        tableExists: (table: string) => Promise<boolean>;
      };
      const real = adapter.tableExists.bind(adapter);
      vi.spyOn(adapter, "tableExists").mockImplementation(async table => {
        if (table === MOVED) throw new Error("the catalogue could not be read");
        return real(table);
      });

      const result = await registry().syncCodeFirstCollections([config]);

      await expectRefused(result);
    });

    // The control: with no table in the way, the move is made and the registry follows it.
    it("moves the collection to its new table when nothing is in the way", async () => {
      const result = await registry().syncCodeFirstCollections([
        await movedConfig(),
      ]);

      expect(result.errors).toEqual([]);
      expect(result.updated).toContain("notes");
      expect(await registeredTable()).toBe(MOVED);
      expect(await titlesIn(MOVED)).toEqual(["Kept"]);
      expect(await current.adapter.tableExists("dc_notes")).toBe(false);
    });
  }
);
