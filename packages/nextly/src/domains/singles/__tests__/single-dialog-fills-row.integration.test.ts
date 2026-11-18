/**
 * A Single's Schema Builder dialog save fills the row the Single already holds, as its PATCH road
 * does, on every dialect.
 *
 * A Single has one row. A field the dialog adds to it takes, in that row, the default the field
 * states (`singleRowFillValue`, the one value both roads use): an optional field's default lands
 * there instead of NULL, and a required field with a stated default fills the row instead of being
 * refused. A required field stating no default is still asked about, the person's own answer wins
 * over the default, a field renamed onto keeps its value, and a unique field is filled too, since
 * one row cannot repeat a value.
 *
 * Every save runs under `NODE_ENV=development`, where a Builder save applies its change at once, in
 * a project directory of its own, where the save writes its migration file.
 */
// Set before the harness boots (env validation reads it once).
process.env.NEXTLY_SECRET =
  process.env.NEXTLY_SECRET ??
  "test-secret-must-be-at-least-32-characters-long!!";

import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { clearRegistryRowCache } from "../../dynamic-collections/services/collection-row-cache";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";

type Field = Record<string, unknown> & { name?: string; type: string };

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const TABLE = "single_sdf_home";
const BODY: Field = { name: "body", type: "text" };

describeEachDialect(
  "a Single's dialog save fills the row it holds",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-single-fill-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
      });
      await dispatchSingles(
        "createSingle",
        {},
        { slug: "sdf_home", label: "Home", fields: [BODY] }
      );
      // The row the Single holds, with a value the saves below must keep.
      await t.nextly.updateSingle({
        slug: "sdf_home",
        data: { body: "kept", _overwrite: true },
      });
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    async function query<T>(sql: string): Promise<T[]> {
      return (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    /** The Single's one row, as the table holds it. */
    async function row(): Promise<Record<string, unknown>> {
      const rows = await query<Record<string, unknown>>(
        `SELECT * FROM ${q(TABLE)}`
      );
      expect(rows).toHaveLength(1);
      return rows[0]!;
    }

    /** Whether the table's `column` takes NULL. */
    async function nullable(column: string): Promise<boolean> {
      const [found] = await query<{ nullable: unknown }>(
        dialect === "sqlite"
          ? `SELECT CASE WHEN "notnull" = 0 THEN 'YES' ELSE 'NO' END AS nullable FROM pragma_table_info('${TABLE}') WHERE name = '${column}'`
          : dialect === "mysql"
            ? `SELECT IS_NULLABLE AS nullable FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}' AND COLUMN_NAME = '${column}'`
            : `SELECT is_nullable AS nullable FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${TABLE}' AND column_name = '${column}'`
      );
      return String(found?.nullable) === "YES";
    }

    /** The Single's schema version, which the dialog sends with its save. */
    async function version(): Promise<number> {
      const [found] = await query<{ v: unknown }>(
        `SELECT ${q("schema_version")} AS v FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'sdf_home'`
      );
      return Number(found?.v ?? 1);
    }

    /** The dialog's save of `fields`, with its answers. */
    async function save(
      fields: Field[],
      answers: Record<string, unknown> = {}
    ): Promise<unknown> {
      return dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "sdf_home" },
        {
          fields,
          confirmed: true,
          schemaVersion: await version(),
          ...answers,
        }
      );
    }

    /** Every migration file the saves wrote, with what it holds. */
    async function migrationText(): Promise<string> {
      const dir = join(basePath, "migrations");
      const files = (await readdir(dir)).filter(f => f.endsWith(".sql"));
      return (
        await Promise.all(files.map(f => readFile(join(dir, f), "utf-8")))
      ).join("\n");
    }

    it("gives an optional field's default to the row, and keeps the field optional", async () => {
      await save([
        BODY,
        { name: "subtitle", type: "text", defaultValue: "Hello" },
      ]);
      const saved = await row();
      expect(saved.subtitle).toBe("Hello");
      expect(saved.body).toBe("kept");
      expect(await nullable("subtitle")).toBe(true);
      // The file a fresh database replays fills the row as this one was filled.
      expect(await migrationText()).toMatch(
        new RegExp(`UPDATE ${q(TABLE)} SET ${q("subtitle")} = `)
      );
    });

    it("fills the row for a required field stating a default, instead of refusing it", async () => {
      await save([
        BODY,
        {
          name: "tagline",
          type: "text",
          required: true,
          defaultValue: "Draft",
        },
      ]);
      expect((await row()).tagline).toBe("Draft");
      expect(await nullable("tagline")).toBe(false);
    });

    // The review shows what the save does: a required field stating a default its row takes is
    // settled by that default, so the dialog does not ask for one.
    it("does not ask, in the review, about a required field stating a default", async () => {
      const answer = await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "sdf_home" },
        {
          fields: [
            BODY,
            {
              name: "tagline",
              type: "text",
              required: true,
              defaultValue: "Draft",
            },
          ],
        }
      );
      const preview = (
        answer instanceof Response ? await answer.json() : answer
      ) as { data?: unknown } & Record<string, unknown>;
      const body = (preview.data ?? preview) as {
        interactiveFields?: { name: string }[];
        classification?: string;
        hasDestructiveChanges?: boolean;
      };
      expect(
        (body.interactiveFields ?? []).map(field => field.name)
      ).not.toContain("tagline");
      // Nothing else changes, so the review is safe and flags no data loss: the dialog shows it
      // as the harmless addition it is.
      expect(body.classification).toBe("safe");
      expect(body.hasDestructiveChanges).toBe(false);
    });

    it("does not ask about a camelCase required field stating a default, and calls the review safe", async () => {
      // A camelCase name the Single already holds, as a plugin or the API may declare it, on a
      // virtual field: it has no column yet, and the Builder keeps a name the Single holds.
      const declared: Field = { name: "tagLine", type: "text", virtual: true };
      await query(
        `UPDATE ${q("dynamic_singles")} SET ${q("fields")} = '${JSON.stringify([BODY, declared])}' WHERE ${q("slug")} = 'sdf_home'`
      );
      // Written past the registry's own writes, so its kept rows are read again.
      clearRegistryRowCache();
      // The dialog stores it now, required and stating a default the row is filled with.
      const answer = await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "sdf_home" },
        {
          fields: [
            BODY,
            {
              name: "tagLine",
              type: "text",
              required: true,
              defaultValue: "Draft",
            },
          ],
        }
      );
      const preview = (
        answer instanceof Response ? await answer.json() : answer
      ) as { data?: unknown } & Record<string, unknown>;
      const body = (preview.data ?? preview) as {
        changes?: {
          added?: { name: string }[];
          changed?: { name: string }[];
        };
        interactiveFields?: { name: string }[];
        classification?: string;
        hasDestructiveChanges?: boolean;
      };
      // The review sees the field among its changes, so the case reaches the settling it is about.
      expect(
        [...(body.changes?.added ?? []), ...(body.changes?.changed ?? [])].map(
          field => field.name
        )
      ).toContain("tagLine");
      expect(body.interactiveFields ?? []).toEqual([]);
      expect(body.classification).toBe("safe");
      expect(body.hasDestructiveChanges).toBe(false);
    });

    // A save that adds a required field stating a default and changes another field's type takes
    // the push road, which judges the type change by the values the column holds: nothing is asked,
    // the row takes the default, and the other column changes type.
    it("fills a required field's default on a save that also changes another field's type", async () => {
      await save([BODY, { name: "count", type: "text" }]);
      const fields: Field[] = [
        BODY,
        { name: "count", type: "number" },
        {
          name: "tagline",
          type: "text",
          required: true,
          defaultValue: "Draft",
        },
      ];
      const answer = await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "sdf_home" },
        { fields }
      );
      const preview = (
        answer instanceof Response ? await answer.json() : answer
      ) as { data?: unknown } & Record<string, unknown>;
      const body = (preview.data ?? preview) as {
        interactiveFields?: { name: string }[];
      };
      expect((body.interactiveFields ?? []).map(field => field.name)).toEqual(
        []
      );

      await save(fields);
      const filled = await row();
      expect(filled.tagline).toBe("Draft");
      expect(filled.body).toBe("kept");
      expect(await nullable("tagline")).toBe(false);
    });

    // A save that also changes a column's type takes the push road, which offers no default for
    // a unique column: the review asks about a required unique field there, as it did before the
    // row was filled, and the person's answer is what the save applies.
    it("asks, on the push road, about a required unique field stating a default", async () => {
      await save([BODY, { name: "count", type: "text" }]);
      const fields: Field[] = [
        BODY,
        { name: "count", type: "number" },
        {
          name: "code",
          type: "text",
          required: true,
          unique: true,
          defaultValue: "U1",
        },
      ];
      const answer = await dispatchSingles(
        "previewSingleSchemaChanges",
        { slug: "sdf_home" },
        { fields }
      );
      const preview = (
        answer instanceof Response ? await answer.json() : answer
      ) as { data?: unknown } & Record<string, unknown>;
      const body = (preview.data ?? preview) as {
        interactiveFields?: { name: string }[];
        classification?: string;
      };
      expect((body.interactiveFields ?? []).map(field => field.name)).toContain(
        "code"
      );
      expect(body.classification).toBe("interactive");

      await save(fields, {
        resolutions: { code: { action: "mark_nullable" } },
      });
      expect(await nullable("code")).toBe(true);
      expect((await row()).body).toBe("kept");
    });

    it("still asks about a required field stating no default", async () => {
      await expect(
        save([BODY, { name: "tagline", type: "text", required: true }])
      ).rejects.toThrow(
        /field 'tagline' cannot be added as required without a default/
      );
      expect(Object.keys(await row())).not.toContain("tagline");
    });

    it("fills the row with the person's own answer over the field's default", async () => {
      await save(
        [
          BODY,
          {
            name: "tagline",
            type: "text",
            required: true,
            defaultValue: "Draft",
          },
        ],
        {
          resolutions: {
            tagline: { action: "provide_default", value: "Mine" },
          },
        }
      );
      expect((await row()).tagline).toBe("Mine");
      // The person's answer for a required column is filled and the column made NOT NULL, as
      // every answered fill was before a fill could leave an optional column nullable.
      expect(await nullable("tagline")).toBe(false);
    });

    it("fills a unique field's default, which one row cannot repeat", async () => {
      await save([
        BODY,
        { name: "code", type: "text", unique: true, defaultValue: "U1" },
      ]);
      expect((await row()).code).toBe("U1");
    });

    it("keeps the value of a field renamed onto, rather than filling it", async () => {
      await save([{ name: "headline", type: "text", defaultValue: "New" }], {
        renameResolutions: [
          {
            tableName: TABLE,
            fromColumn: "body",
            toColumn: "headline",
            choice: "rename",
          },
        ],
      });
      expect((await row()).headline).toBe("kept");
    });

    it("fills a date field's default as the moment it names, in the form the dialect stores", async () => {
      const moment = "2026-01-02T03:04:05.000Z";
      await save([
        BODY,
        { name: "launch", type: "date", defaultValue: moment },
      ]);
      const stored = (await row()).launch;
      if (dialect === "sqlite") {
        // SQLite keeps a date as epoch seconds, never the ISO text.
        expect(Number(stored)).toBe(Date.parse(moment) / 1000);
      }
      const read = (await t.nextly.findSingle({ slug: "sdf_home" })) as {
        launch?: unknown;
      };
      expect(new Date(read.launch as string).toISOString()).toBe(moment);
    });

    it("refuses a default the field's own rules refuse, changing nothing", async () => {
      const columns = Object.keys(await row());
      await expect(
        save([
          BODY,
          {
            name: "count",
            type: "number",
            defaultValue: 0,
            validation: { min: 1 },
          },
        ])
      ).rejects.toMatchObject({
        publicData: {
          errors: [
            expect.objectContaining({ code: "DEFAULT_FAILS_FIELD_RULES" }),
          ],
        },
      });
      expect(Object.keys(await row())).toEqual(columns);
    });

    it("fills a field named after an object member, which is no answer the person gave", async () => {
      await save([
        BODY,
        { name: "constructor", type: "text", defaultValue: "C" },
      ]);
      expect((await row()).constructor).toBe("C");
    });
  }
);

describeEachDialect(
  "a translated Single's dialog save and its row",
  dialect => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-single-fill-i18n-"));
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: { locales: ["en", "de"], defaultLocale: "en" },
      });
      await dispatchSingles(
        "createSingle",
        {},
        {
          slug: "sdf_home",
          label: "Home",
          fields: [BODY],
          localized: true,
        }
      );
      await t.nextly.updateSingle({
        slug: "sdf_home",
        locale: "en",
        data: { body: "kept", _overwrite: true },
      });
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    // A translated field's values live in the Single's translations table, one row per language,
    // not on its main row: its default is no fill for the main row.
    it("saves a translated field added with a default, filling nothing on the main row", async () => {
      const [found] = (await (
        t.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<{ v: unknown }>(
        `SELECT ${dialect === "mysql" ? "`schema_version`" : '"schema_version"'} AS v FROM ${dialect === "mysql" ? "`dynamic_singles`" : '"dynamic_singles"'} WHERE ${dialect === "mysql" ? "`slug`" : '"slug"'} = 'sdf_home'`
      )) as { v: unknown }[];
      await dispatchSingles(
        "applySingleSchemaChanges",
        { slug: "sdf_home" },
        {
          fields: [
            BODY,
            {
              name: "motto",
              type: "text",
              localized: true,
              defaultValue: "Hi",
            },
          ],
          confirmed: true,
          schemaVersion: Number(found?.v ?? 1),
          localized: true,
        }
      );
      const read = (await t.nextly.findSingle({
        slug: "sdf_home",
        locale: "en",
      })) as { body?: unknown };
      expect(read.body).toBe("kept");
      // The main row has no column for it: the translated field lives in the translations table.
      const columns = (
        await (
          t.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ name: string }>(
          dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${TABLE}')`
            : dialect === "mysql"
              ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${TABLE}'`
              : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${TABLE}'`
        )
      ).map(row => row.name);
      expect(columns).toContain("id");
      expect(columns).not.toContain("motto");
    });
  }
);
