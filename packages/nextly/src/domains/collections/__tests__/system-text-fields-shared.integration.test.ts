/**
 * A translated collection made in the Schema Builder declares no title or slug of its own. Its
 * reads say the system ones are not translated, and nothing it stores changes for that:
 * - the registry keeps the fields the author made, without the two;
 * - the two stay columns of the collection's own table, and never of its translations table;
 * - saving the fields the Builder holds changes nothing in the database.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { introspectLiveSnapshot } from "../../schema/pipeline/diff/introspect-live";
import { DrizzleStatementExecutor } from "../../schema/services/drizzle-statement-executor";

type Field = { name: string; localized?: boolean };

interface CollectionsHandler {
  createCollection(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  updateCollection(
    params: { collectionName: string },
    body: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getCollection(params: {
    collectionName: string;
  }): Promise<{ data?: { fields?: Field[] } | null }>;
  listCollections(): Promise<{
    data?: { slug?: string; fields?: Field[] }[] | null;
  }>;
}

/** The fields the author made: one translated, one shared. */
const FIELDS = [
  { name: "body", type: "text" },
  { name: "rank", type: "number" },
];

describeEachDialect(
  "a translated collection without its own title",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The Builder's save applies its change in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization: { locales: ["en", "es"], defaultLocale: "en" },
      });
      const created = await handler().createCollection({
        name: "notes",
        label: "Note",
        localized: true,
        fields: FIELDS,
      });
      expect(created.success, JSON.stringify(created)).toBe(true);
    });

    afterEach(async () => {
      vi.restoreAllMocks();
      await current?.destroy();
      vi.unstubAllEnvs();
    });

    const handler = () =>
      current.getService("collectionsHandler") as unknown as CollectionsHandler;

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function recordedFields(): Promise<Field[]> {
      const [row] = await current.adapter.executeQuery<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_collections")} WHERE ${q("slug")} = 'notes'`
      );
      return (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as Field[];
    }

    /** Each of the collection's two tables, by its columns' names. */
    async function liveColumns(): Promise<Record<string, string[]>> {
      const { tables } = await introspectLiveSnapshot(
        current.adapter.getDrizzle(),
        dialect,
        ["dc_notes", "dc_notes_locales"]
      );
      return Object.fromEntries(
        tables.map(table => [
          table.name,
          table.columns.map(column => column.name).sort(),
        ])
      );
    }

    const localizedOf = (fields: readonly Field[] | undefined) =>
      Object.fromEntries(
        (fields ?? []).map(({ name, localized }) => [name, localized])
      );

    it("says the system title and slug are not translated, in its own read and the list", async () => {
      const said = {
        title: false,
        slug: false,
        body: undefined,
        rank: undefined,
      };

      const read = await handler().getCollection({ collectionName: "notes" });
      expect(localizedOf(read.data?.fields)).toEqual(said);
      const list = await handler().listCollections();
      expect(
        localizedOf(list.data?.find(each => each.slug === "notes")?.fields)
      ).toEqual(said);
    });

    it("keeps the two out of its record and of its translations table", async () => {
      expect((await recordedFields()).map(field => field.name)).toEqual([
        "body",
        "rank",
      ]);
      const columns = await liveColumns();
      expect(columns.dc_notes).toEqual(
        expect.arrayContaining(["title", "slug", "rank"])
      );
      expect(columns.dc_notes).not.toContain("body");
      expect(columns.dc_notes_locales).toContain("body");
      for (const name of ["title", "slug"]) {
        expect(columns.dc_notes_locales).not.toContain(name);
      }
    });

    it("changes nothing when the fields the author made are saved again", async () => {
      const before = await liveColumns();
      const recorded = await recordedFields();
      const run = vi.spyOn(
        DrizzleStatementExecutor.prototype,
        "executeStatements"
      );

      const saved = await handler().updateCollection(
        { collectionName: "notes" },
        { fields: recorded, localized: true }
      );

      expect(saved.success, JSON.stringify(saved)).toBe(true);
      expect(run.mock.calls.flatMap(([, statements]) => statements)).toEqual(
        []
      );
      expect(await liveColumns()).toEqual(before);
      expect(await recordedFields()).toEqual(recorded);
    });
  }
);
