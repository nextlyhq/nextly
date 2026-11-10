/**
 * A field renamed onto a column that is already there is refused before anything is written, on
 * every road that applies a schema change from the admin: the collection Builder save, and the
 * schema dialogs of a collection, a Single and a field group. On every dialect.
 *
 * In a dialog the rename is not offered as one when its new column is already there: the change
 * reads as the old column dropped and the field kept on the column that is there, and confirming
 * that drop would lose the field's values to a column someone else left. So the rename is found
 * from the field lists, as the Builder save finds it, and refused with `RENAME_TARGET_TAKEN`,
 * naming the table and both columns. Nothing changes: the registry keeps the old field, both
 * columns stay, and the value is read under the old name.
 *
 * Controls: a rename onto a free name goes through; a rename this database already made (the new
 * column there, the old one gone) saves; and a save refused here is refused once, with one entry.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its DDL at once.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { STORAGE_FORMAT } from "../../../schemas/storage-format";
import type { ServiceContainer } from "../../../services";

const localization = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown> & { name: string; type: string };

const BEFORE: Field[] = [
  { name: "heading", type: "text" },
  { name: "body", type: "text" },
];
const RENAMED: Field[] = [
  { name: "headline", type: "text" },
  { name: "body", type: "text" },
];

describeEachDialect(
  "a rename onto a column that is there, on the apply roads",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization,
      });
    });

    afterEach(async () => {
      await current.destroy();
      vi.unstubAllEnvs();
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

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name).sort();
    }

    /** The registry row's field names and schema version for `slug` in `registry`. */
    async function registered(
      registry: string,
      slug: string
    ): Promise<{ names: string[]; version: number }> {
      const [row] = await query<{ fields: unknown; schema_version: unknown }>(
        `SELECT ${q("fields")} AS fields, ${q("schema_version")} AS schema_version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return {
        names: fields.map(field => field.name),
        version: Number(row?.schema_version ?? 1),
      };
    }

    /** What a save answered: its refusal's per-field entries, or "accepted". */
    async function answerOf(
      run: () => Promise<unknown>
    ): Promise<"accepted" | { code?: string; message?: string }[]> {
      let result: unknown;
      try {
        result = await run();
      } catch (error) {
        const e = error as {
          code?: string;
          message?: string;
          publicData?: { errors?: { code?: string; message?: string }[] };
        };
        return e.publicData?.errors ?? [{ code: e.code, message: e.message }];
      }
      const failed = result as {
        success?: boolean;
        code?: string;
        message?: string;
        data?: { errors?: { code?: string; message?: string }[] };
      } | null;
      if (failed && failed.success === false) {
        return (
          failed.data?.errors ?? [
            { code: failed.code, message: failed.message },
          ]
        );
      }
      return "accepted";
    }

    /** The one refusal every road gives, naming the table and both columns. */
    function takenOn(table: string) {
      return [
        expect.objectContaining({
          code: "RENAME_TARGET_TAKEN",
          message: expect.stringContaining(
            `Column 'heading' cannot be renamed to 'headline': table '${table}' already has a column 'headline'`
          ),
        }),
      ];
    }

    const confirmDrop = (table: string) => [
      { kind: "confirm_drop", eventId: `destructive_drop:${table}.heading` },
    ];

    /** A Builder collection `posts` holding one entry whose heading is "Kept". */
    async function posts(localized = false): Promise<void> {
      const fields = localized
        ? [{ name: "heading", type: "text", localized: true }, BEFORE[1]]
        : BEFORE;
      expect(
        await answerOf(() =>
          dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            {
              name: "posts",
              label: "Posts",
              fields,
              ...(localized ? { localized: true } : {}),
            }
          )
        )
      ).toBe("accepted");
      const created = await current.nextly.create({
        collection: "posts",
        data: { heading: "Kept" },
        ...(localized ? { locale: "en" } : {}),
      });
      expect(created.item).toMatchObject({ heading: "Kept" });
    }

    async function headingsIn(
      table: string,
      column = "heading"
    ): Promise<unknown[]> {
      const rows = await query<{ v: unknown }>(
        `SELECT ${q(column)} AS v FROM ${q(table)}`
      );
      return rows.map(row => row.v);
    }

    it("refuses the collection Builder save, once, and writes nothing", async () => {
      await posts();
      await query(
        `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("headline")} TEXT`
      );
      const columnsBefore = await columnsOf("dc_posts");

      const answer = await answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: "posts" },
          { fields: RENAMED }
        )
      );

      // One entry: the save is refused once, not by each step that asks.
      expect(answer).toEqual(takenOn("dc_posts"));
      expect((await registered("dynamic_collections", "posts")).names).toEqual([
        "heading",
        "body",
      ]);
      expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
      expect(await headingsIn("dc_posts")).toEqual(["Kept"]);
    });

    it("refuses the collection dialog that would drop the old column onto the one there", async () => {
      await posts();
      await query(
        `ALTER TABLE ${q("dc_posts")} ADD COLUMN ${q("headline")} TEXT`
      );
      const columnsBefore = await columnsOf("dc_posts");
      const { version } = await registered("dynamic_collections", "posts");

      const answer = await answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: RENAMED,
            confirmed: true,
            schemaVersion: version,
            eventResolutions: confirmDrop("dc_posts"),
            renameResolutions: [],
          }
        )
      );

      expect(answer).toEqual(takenOn("dc_posts"));
      expect((await registered("dynamic_collections", "posts")).names).toEqual([
        "heading",
        "body",
      ]);
      expect(await columnsOf("dc_posts")).toEqual(columnsBefore);
      expect(await headingsIn("dc_posts")).toEqual(["Kept"]);
    });

    it("refuses the collection dialog's rename of a translated field onto a column its companion has", async () => {
      await posts(true);
      await query(
        `ALTER TABLE ${q("dc_posts_locales")} ADD COLUMN ${q("headline")} TEXT`
      );
      const companionBefore = await columnsOf("dc_posts_locales");
      const { version } = await registered("dynamic_collections", "posts");

      const answer = await answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: [
              { name: "headline", type: "text", localized: true },
              BEFORE[1],
            ],
            confirmed: true,
            schemaVersion: version,
            eventResolutions: confirmDrop("dc_posts_locales"),
            renameResolutions: [],
          }
        )
      );

      expect(answer).toEqual(takenOn("dc_posts_locales"));
      expect(await columnsOf("dc_posts_locales")).toEqual(companionBefore);
      expect(await headingsIn("dc_posts_locales")).toEqual(["Kept"]);
    });

    it("refuses the Single dialog that would drop the old column onto the one there", async () => {
      expect(
        await answerOf(() =>
          dispatchSingles(
            "createSingle",
            {},
            { slug: "hero", label: "Hero", fields: BEFORE }
          )
        )
      ).toBe("accepted");
      await query(`UPDATE ${q("single_hero")} SET ${q("heading")} = 'Kept'`);
      await query(
        `ALTER TABLE ${q("single_hero")} ADD COLUMN ${q("headline")} TEXT`
      );
      const columnsBefore = await columnsOf("single_hero");
      const { version } = await registered("dynamic_singles", "hero");

      const answer = await answerOf(() =>
        dispatchSingles(
          "applySingleSchemaChanges",
          { slug: "hero" },
          {
            fields: RENAMED,
            confirmed: true,
            schemaVersion: version,
            eventResolutions: confirmDrop("single_hero"),
            renameResolutions: [],
          }
        )
      );

      expect(answer).toEqual(takenOn("single_hero"));
      expect((await registered("dynamic_singles", "hero")).names).toEqual([
        "heading",
        "body",
      ]);
      expect(await columnsOf("single_hero")).toEqual(columnsBefore);
    });

    it("refuses the field group dialog that would drop the old column onto the one there", async () => {
      expect(
        await answerOf(() =>
          dispatchComponents(
            "createComponent",
            {},
            { slug: "promo", label: "Promo", fields: BEFORE }
          )
        )
      ).toBe("accepted");
      await query(
        `ALTER TABLE ${q("comp_promo")} ADD COLUMN ${q("headline")} TEXT`
      );
      const columnsBefore = await columnsOf("comp_promo");
      const { version } = await registered(
        STORAGE_FORMAT.registryTable,
        "promo"
      );

      const answer = await answerOf(() =>
        dispatchComponents(
          "applyComponentSchemaChanges",
          { slug: "promo" },
          {
            fields: RENAMED,
            confirmed: true,
            schemaVersion: version,
            eventResolutions: confirmDrop("comp_promo"),
            renameResolutions: [],
          }
        )
      );

      expect(answer).toEqual(takenOn("comp_promo"));
      expect(
        (await registered(STORAGE_FORMAT.registryTable, "promo")).names
      ).toEqual(["heading", "body"]);
      expect(await columnsOf("comp_promo")).toEqual(columnsBefore);
    });

    // The control: with nothing in the way, the dialog's rename goes through and the value follows.
    it("applies the collection dialog's rename onto a free name", async () => {
      await posts();
      const { version } = await registered("dynamic_collections", "posts");

      const answer = await answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: "posts" },
          {
            fields: RENAMED,
            confirmed: true,
            schemaVersion: version,
            eventResolutions: [],
            renameResolutions: [
              {
                tableName: "dc_posts",
                fromColumn: "heading",
                toColumn: "headline",
                choice: "rename",
              },
            ],
          }
        )
      );

      expect(answer).toBe("accepted");
      expect(await headingsIn("dc_posts", "headline")).toEqual(["Kept"]);
    });

    // The control: a rename this database already made (the new column there, the old one gone)
    // is not a move onto a taken column, and the Builder save records it.
    it("saves a collection rename this database already made", async () => {
      await posts();
      await query(
        `ALTER TABLE ${q("dc_posts")} RENAME COLUMN ${q("heading")} TO ${q("headline")}`
      );

      const answer = await answerOf(() =>
        dispatchCollections(
          {} as ServiceContainer,
          "updateCollection",
          { collectionName: "posts" },
          { fields: RENAMED }
        )
      );

      expect(answer).toBe("accepted");
      expect((await registered("dynamic_collections", "posts")).names).toEqual([
        "headline",
        "body",
      ]);
    });
  }
);
