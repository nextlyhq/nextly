/**
 * A collection save that runs its own migration file is held to the checks the push makes before
 * it changes anything, so a save is refused for the same reasons on either road:
 *
 * - a unique field whose index name an index elsewhere already holds, which the file's
 *   `CREATE UNIQUE INDEX IF NOT EXISTS` would skip, recording the field unique with nothing
 *   enforcing it;
 * - a column of the table no field describes, left unanswered, which the save must not drop with
 *   its data. One the request answers, as a rename onto a field it adds, is not refused as
 *   undescribed: the history's drift check judges it, as it does any column the history lacks.
 *
 * One step the push takes once it has run is not the file road's: Unique turned off while another
 * unique index covers the column, the push drops that index too. The file does not carry that drop,
 * so a database the file is replayed on keeps the index; dropping it here alone would have this
 * database accept repeats that database refuses. Pinned below as the gap it is, until the file
 * carries the drop.
 *
 * Each runs through the collection's schema dialog in development, where an untranslated
 * collection's save runs its file.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
import { PushSchemaPipeline } from "../../pipeline/pushschema-pipeline";
import { uniqueIndexNameForColumn } from "../../services/index-name";

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
    message?: string;
  }>;
  getEntryService(): {
    createEntry(
      params: { collectionName: string; overrideAccess?: boolean },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; message?: string }>;
  };
}

const HEADING = { name: "heading", type: "text" };
// Short, as the other dialects' unique indexes need.
const CODE = {
  name: "code",
  type: "text",
  options: { variant: "short" },
  validation: { maxLength: 64 },
};

describeEachDialect(
  "a collection save that runs its own file, held to the push's checks",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({ dialect, collections: [] });
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await current.destroy();
      vi.unstubAllEnvs();
    });

    const handler = () =>
      current.getService("collectionsHandler") as unknown as CollectionsHandler;
    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const query = <T>(sql: string): Promise<T[]> =>
      (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    const columnsOf = async (table: string): Promise<string[]> =>
      (
        await query<{ name: string }>(
          dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : dialect === "mysql"
              ? `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = '${table}'`
              : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
        )
      ).map(row => row.name);

    /** A collection with the given fields and one entry per value of `heading`. */
    async function collectionWith(
      name: string,
      fields: unknown[],
      entries: Array<Record<string, unknown>>
    ): Promise<void> {
      const created = await handler().createCollection({
        name,
        label: name,
        fields,
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
      for (const data of entries) {
        const entry = await handler()
          .getEntryService()
          .createEntry({ collectionName: name, overrideAccess: true }, data);
        expect(entry.success, JSON.stringify(entry)).toBe(true);
      }
    }

    /** The schema dialog's save of `fields` on `posts`, with its rename answers; the refusal, or undefined. */
    async function dialogSave(
      fields: unknown[],
      renameResolutions: unknown[] = []
    ): Promise<unknown> {
      const [row] = await query<{ v: number | string | null }>(
        `SELECT schema_version AS v FROM ${q("dynamic_collections")} WHERE slug = 'posts'`
      );
      return dispatchCollections(
        {} as ServiceContainer,
        "applySchemaChanges",
        { collectionName: "posts" },
        {
          fields,
          renameResolutions,
          confirmed: true,
          schemaVersion: Number(row?.v ?? 1),
        }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }
    const told = (refusal: unknown) =>
      `${refusal instanceof Error ? refusal.message : String(refusal)} ${JSON.stringify(refusal)}`;

    // MySQL names an index per table, so nothing elsewhere can take the name there.
    it.skipIf(dialect === "mysql")(
      "refuses a unique field whose index name an index on another table holds, and saves once it is gone",
      async () => {
        await collectionWith("posts", [HEADING], [{ heading: "One" }]);
        await collectionWith("notes", [HEADING], [{ heading: "Note" }]);
        const blocking = uniqueIndexNameForColumn("dc_posts", "code");
        await query(
          `CREATE INDEX ${q(blocking)} ON ${q("dc_notes")} (${q("id")})`
        );
        const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

        const refused = await dialogSave([HEADING, { ...CODE, unique: true }]);

        // The save ran its file's road, and was refused there before anything changed.
        expect(pushed).not.toHaveBeenCalled();
        expect(told(refused)).toContain(blocking);
        expect(await columnsOf("dc_posts")).not.toContain("code");

        // Once the name is free, the field is saved and its index enforces it.
        await query(`DROP INDEX ${q(blocking)}`);
        expect(
          await dialogSave([HEADING, { ...CODE, unique: true }])
        ).toBeUndefined();
        const entries = handler().getEntryService();
        const first = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "Two", code: "same" }
        );
        expect(first.success, JSON.stringify(first)).toBe(true);
        const second = await entries.createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "Three", code: "same" }
        );
        expect(second.success, JSON.stringify(second)).toBe(false);
      }
    );

    it("refuses a save leaving a column no field describes unanswered, keeping it with its data", async () => {
      await collectionWith("posts", [HEADING], [{ heading: "One" }]);
      await query(
        `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("legacy_note")} TEXT`
      );
      await query(`UPDATE ${q("dc_posts")} SET ${q("legacy_note")} = 'kept'`);

      const refused = await dialogSave([HEADING, { ...CODE }]);

      // Refused as the push refuses it, naming the column.
      expect(told(refused)).toContain("COLUMN_NOT_DESCRIBED");
      expect(told(refused)).toContain("legacy_note");
      const kept = await query<{ note: string | null }>(
        `SELECT ${q("legacy_note")} AS note FROM ${q("dc_posts")}`
      );
      expect(kept.map(row => row.note)).toEqual(["kept"]);
    });

    it("leaves a column no field describes, answered as a rename onto the field it adds, to the history's drift check", async () => {
      await collectionWith("posts", [HEADING], [{ heading: "One" }]);
      await query(
        `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("legacy_note")} TEXT`
      );
      await query(`UPDATE ${q("dc_posts")} SET ${q("legacy_note")} = 'kept'`);
      const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

      const refused = await dialogSave(
        [HEADING, { ...CODE }],
        [
          {
            tableName: "dc_posts",
            fromColumn: "legacy_note",
            toColumn: "code",
            choice: "rename",
          },
        ]
      );

      // Answered, so not refused as left over. The file cannot rename a column its history never
      // recorded, so the writer's drift check refuses the save, naming the column, with nothing
      // changed: the column keeps its values for the person to describe or drop.
      expect(pushed).not.toHaveBeenCalled();
      expect(told(refused)).not.toContain("COLUMN_NOT_DESCRIBED");
      expect(told(refused)).toContain("NEXTLY_MIGRATION_DRIFT");
      expect(told(refused)).toContain("legacy_note");
      const kept = await query<{ note: string | null }>(
        `SELECT ${q("legacy_note")} AS note FROM ${q("dc_posts")}`
      );
      expect(kept.map(row => row.note)).toEqual(["kept"]);
      expect(await columnsOf("dc_posts")).not.toContain("code");
    });

    // The gap, pinned: the file does not carry the drop of a unique index it did not declare, so the
    // file road leaves it, and the column still refuses repeats here as on any database the file is
    // replayed on. Once the file carries that drop, both accept them and this is turned round.
    it("keeps another unique index covering the column when Unique is turned off, as the file leaves it everywhere", async () => {
      await collectionWith(
        "posts",
        [HEADING, { ...CODE, unique: true }],
        [{ heading: "One", code: "a" }]
      );
      await query(
        `CREATE UNIQUE INDEX ${q("posts_code_key")} ON ${q("dc_posts")} (${q("code")})`
      );

      const pushed = vi.spyOn(PushSchemaPipeline.prototype, "apply");

      expect(await dialogSave([HEADING, { ...CODE }])).toBeUndefined();

      // Saved on the file's road; the index it did not declare still holds the column unique.
      expect(pushed).not.toHaveBeenCalled();
      const repeat = await handler()
        .getEntryService()
        .createEntry(
          { collectionName: "posts", overrideAccess: true },
          { heading: "Two", code: "a" }
        );
      expect(repeat.success, JSON.stringify(repeat)).toBe(false);
    });
  }
);
