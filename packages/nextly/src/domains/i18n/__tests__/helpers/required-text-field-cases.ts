/**
 * A text field made required in the Schema Builder, answered with a fill or a delete for the
 * entries that hold no value for it, settles exactly those entries wherever the values are kept:
 * the main table on the earlier layout, the translations table's default-language rows under
 * per-language storage or for a translated collection. An entry with no value in the default
 * language, its default-language row there and empty or missing altogether, is filled there or
 * deleted with every language's row; an entry that has the value keeps it, and a value in another
 * language is kept.
 *
 * Every road a save takes is covered: the dialog's apply, which takes the road the dispatcher
 * picks for it (here the save's migration file, run in development, with the translations table
 * brought in step after it); the save's own migration file, run as `nextly migrate` runs it on a
 * deploy; and the push, which applies a change whose values the file cannot carry (a column's type
 * changing beside it) and which settles the answers itself once the translations table is in step.
 * The review counts the entries each answer settles. An answer for a field the save leaves
 * optional is refused by the save, and passed over by the push, which asks it nothing.
 *
 * A Single's dialog save that adds a text field stating a default gives the Single's document that
 * default in the default language, wherever the field's values are kept: in development, where its
 * file runs, and outside it, where its push applies the change once the files are written.
 *
 * Shared by the suite on the earlier layout and the one on per-language storage, as every
 * installation runs it, so both layouts answer the same cases.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { builderSaveDeps } from "../../../../dispatcher/helpers/builder-save-change";
import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { UiSchemaEntity } from "../../../../schemas/_zod/ui-schema";
import type { FieldDefinition } from "../../../../schemas/dynamic-collections";
import type { ServiceContainer } from "../../../../services";
import {
  previewCollectionSave,
  writeCollectionSave,
} from "../../../schema/builder-save/collection-save";
import type { Resolution } from "../../../schema/pipeline/resolution/types";
import { resolutionStatements } from "../../../schema/pipeline/sql-templates/resolution-statements";
import { applyCollectionSchemaChange } from "../../../schema/services/collection-schema-apply";
import { encodeStamp } from "../../runtime/companion-stamp-column";
import { loadUiSchema } from "../../../schema/ui-schema/loader";

interface Entries {
  createEntry(
    params: {
      collectionName: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; data: unknown }>;
  updateEntry(
    params: {
      collectionName: string;
      entryId: string;
      overrideAccess?: boolean;
      locale?: string;
    },
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntry(params: {
    collectionName: string;
    entryId: string;
    overrideAccess?: boolean;
    locale?: string;
  }): Promise<{ success: boolean; data: unknown }>;
}

interface CollectionsHandler {
  createCollection(
    data: Record<string, unknown>
  ): Promise<{ success: boolean; message?: string }>;
  getEntryService(): Entries;
}

/** The roads a collection's change takes: the dialog's choice, the save's file, the push. */
const ROADS = ["dialog", "file", "push"] as const;
type Road = (typeof ROADS)[number];

/** The person's answer for the entries without a value. */
type Answer =
  | { kind: "fill"; value: string }
  | { kind: "delete_nonconforming" };

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/** The moment `LONG_AGO` names, in milliseconds. */
const LONG_AGO_MS = Date.UTC(2000, 0, 1);

/** A stamp long before any test runs, as each dialect's `_updated_at` column takes it. */
const LONG_AGO: Record<TestDialect, string> = {
  sqlite: String(LONG_AGO_MS / 1000),
  postgresql: "'2000-01-01T00:00:00Z'",
  mysql: "'2000-01-01 00:00:00.000'",
};

/**
 * The cases, for `layout`, with each collection and Single named from `prefix` so the two suites
 * never share a table.
 */
export function requiredTextFieldCases(
  layout: "earlier" | "per-language",
  prefix: string
): void {
  describeEachDialect(
    `a text field made required in the Builder (${layout} layout)`,
    dialect => {
      let current: TestNextly;
      let basePath: string;

      beforeEach(async () => {
        basePath = await mkdtemp(join(tmpdir(), "nextly-required-text-"));
        // The Builder's apply runs its change in development only.
        vi.stubEnv("NODE_ENV", "development");
        current = await createTestNextly({
          dialect,
          basePath,
          db: DB,
          collections: [],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
      });

      afterEach(async () => {
        try {
          await current.destroy();
        } finally {
          vi.unstubAllEnvs();
          await rm(basePath, { recursive: true, force: true });
        }
      });

      const handler = () =>
        current.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler;

      async function query<R>(statement: string): Promise<R[]> {
        return (
          current.adapter as unknown as {
            executeQuery<T>(sql: string): Promise<T[]>;
          }
        ).executeQuery<R>(statement);
      }

      async function schemaVersionOf(
        registry: "dynamic_collections" | "dynamic_singles",
        slug: string
      ): Promise<number> {
        const [row] = await query<{ version: number | string | null }>(
          `SELECT ${quote(dialect, "schema_version")} AS version FROM ${quote(dialect, registry)} WHERE ${quote(dialect, "slug")} = '${slug}'`
        );
        return Number(row?.version ?? 1);
      }

      /** The entry's field values in `locale`, read as an editor reads them. */
      async function readIn(
        slug: string,
        id: string,
        locale: string
      ): Promise<Record<string, unknown>> {
        const read = await handler().getEntryService().getEntry({
          collectionName: slug,
          entryId: id,
          overrideAccess: true,
          locale,
        });
        expect(read.success, JSON.stringify(read)).toBe(true);
        return read.data as Record<string, unknown>;
      }

      /**
       * A collection with text fields `heading` and `note`, and three entries: one with a note
       * (`kept`), and two with none, one of which (`bare`) has no default-language row at all where
       * the values are kept per language. A translated collection's `bare` entry has a Spanish note,
       * which no answer for the default language may lose.
       */
      async function notesWithEntries(
        slug: string,
        translated: boolean
      ): Promise<{ kept: string; empty: string; bare: string }> {
        const created = await handler().createCollection({
          name: slug,
          label: "Note",
          localized: translated,
          fields: [
            { name: "heading", type: "text" },
            { name: "note", type: "text" },
          ],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
        const entries = handler().getEntryService();
        const write = async (data: Record<string, unknown>) => {
          const entry = await entries.createEntry(
            { collectionName: slug, overrideAccess: true, locale: "en" },
            data
          );
          expect(entry.success, JSON.stringify(entry)).toBe(true);
          return String((entry.data as { id: unknown }).id);
        };
        const kept = await write({ heading: "Kept", note: "kept" });
        const empty = await write({ heading: "Empty" });
        const bare = await write({ heading: "Bare" });
        if (translated) {
          const spanish = await entries.updateEntry(
            {
              collectionName: slug,
              entryId: bare,
              overrideAccess: true,
              locale: "es",
            },
            // The language's first write: nothing earlier of it to have lost.
            { heading: "Desnuda", note: "nota", _overwrite: true }
          );
          expect(spanish.success, JSON.stringify(spanish)).toBe(true);
        }
        if (keptPerLanguage(translated)) {
          // An entry whose default-language row is missing altogether, as one written in another
          // language first, or before the field's collection kept its values per language, has.
          await query(
            `DELETE FROM ${quote(dialect, `dc_${slug}_locales`)} WHERE ${quote(dialect, "_parent")} = '${bare}' AND ${quote(dialect, "_locale")} = 'en'`
          );
        }
        return { kept, empty, bare };
      }

      const keptPerLanguage = (translated: boolean) =>
        layout === "per-language" || translated;

      /**
       * A collection whose text field `note` is kept once for every language, and three entries:
       * one with a note, two with none.
       */
      async function sharedNotes(
        slug: string,
        translated: boolean
      ): Promise<{ kept: string; empty: string; bare: string }> {
        const created = await handler().createCollection({
          name: slug,
          label: "Note",
          localized: translated,
          fields: [
            { name: "heading", type: "text" },
            { name: "note", type: "text", localized: false },
          ],
        });
        expect(created.success, JSON.stringify(created)).toBe(true);
        const write = async (data: Record<string, unknown>) => {
          const entry = await handler()
            .getEntryService()
            .createEntry(
              { collectionName: slug, overrideAccess: true, locale: "en" },
              data
            );
          expect(entry.success, JSON.stringify(entry)).toBe(true);
          return String((entry.data as { id: unknown }).id);
        };
        return {
          kept: await write({ heading: "Kept", note: "kept" }),
          empty: await write({ heading: "Empty" }),
          bare: await write({ heading: "Bare" }),
        };
      }

      /** A save's change, the field it settles, and how many entries hold no value for it. */
      interface Change {
        fields: Record<string, unknown>[];
        field: string;
        /** The event the dialog's typed answer names, as the main table's column. */
        event: "add_not_null_with_nulls" | "add_required_field_no_default";
        without: number;
        /** The columns the save renames, each answered as a rename where its values are kept. */
        renames?: { from: string; to: string }[];
      }

      /** `note` made required: the two entries without a note do not fit it. */
      const NOTE_REQUIRED: Change = {
        fields: [
          { name: "heading", type: "text" },
          { name: "note", type: "text", required: true },
        ],
        field: "note",
        event: "add_not_null_with_nulls",
        without: 2,
      };

      /** A required `summary` added: no entry holds a value for it, so none fits it. */
      const SUMMARY_ADDED: Change = {
        fields: [
          { name: "heading", type: "text" },
          { name: "note", type: "text" },
          { name: "summary", type: "text", required: true },
        ],
        field: "summary",
        event: "add_required_field_no_default",
        without: 3,
      };

      /**
       * `note` renamed to `remark` and required, in one save: the entries its values leave empty
       * under the old name are the two that do not fit it.
       */
      const NOTE_RENAMED_REQUIRED: Change = {
        fields: [
          { name: "heading", type: "text" },
          { name: "remark", type: "text", required: true },
        ],
        field: "remark",
        event: "add_not_null_with_nulls",
        without: 2,
        renames: [{ from: "note", to: "remark" }],
      };

      /** `change`'s renames as the dialog answers them, on the table the values are kept in. */
      const renamesOf = (slug: string, translated: boolean, change: Change) =>
        (change.renames ?? []).map(rename => ({
          tableName: keptPerLanguage(translated)
            ? `dc_${slug}_locales`
            : `dc_${slug}`,
          fromColumn: rename.from,
          toColumn: rename.to,
          choice: "rename" as const,
        }));

      /** The answer as the dialog's typed resolution names it, by the main table's column. */
      const resolutionOf = (slug: string, change: Change, answer: Answer) => ({
        eventId: `${change.event}:dc_${slug}.${change.field}`,
        ...answer,
        ...(answer.kind === "fill"
          ? { kind: "provide_default", value: answer.value }
          : {}),
      });

      /** The review's line for `answer`, over the entries without a value. */
      const noticeOf = (change: Change, answer: Answer) => {
        const rows = `${change.without} ${change.without === 1 ? "row" : "rows"}`;
        return answer.kind === "fill"
          ? `This save fills ${rows} with '${answer.value}' in ${change.field}.`
          : `This save also deletes ${rows} here, and the rows that don't fit on every database the migration reaches.`;
      };

      /** The dialog's review and apply of `change`, answered with `answer`. */
      async function throughDialog(
        slug: string,
        translated: boolean,
        answer: Answer,
        change: Change = NOTE_REQUIRED
      ): Promise<void> {
        const answers = {
          eventResolutions: [resolutionOf(slug, change, answer)],
          renameResolutions: renamesOf(slug, translated, change),
        };
        const preview = (await dispatchCollections(
          {} as ServiceContainer,
          "previewSchemaChanges",
          { collectionName: slug },
          { fields: change.fields, ...answers }
        )) as unknown as Response;
        const reviewed = (await preview.json()) as {
          notices?: string[];
          data?: { notices?: string[] };
        };
        expect((reviewed.data ?? reviewed).notices).toEqual([
          noticeOf(change, answer),
        ]);

        const applied = await appliedThroughDialog(
          slug,
          translated,
          change.fields,
          answers
        );
        expect(applied.ok, await applied.clone().text()).toBe(true);
      }

      /** The dialog's apply of `fields` with `answers`, as it answers: not judged here. */
      async function appliedThroughDialog(
        slug: string,
        translated: boolean,
        fields: Record<string, unknown>[],
        answers: Record<string, unknown>
      ): Promise<Response> {
        return (await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields,
            confirmed: true,
            ...(translated ? { localized: true } : {}),
            ...answers,
            schemaVersion: await schemaVersionOf("dynamic_collections", slug),
          }
        )) as unknown as Response;
      }

      /** The same change as the save's own migration file, run as `nextly migrate` runs it. */
      async function throughFile(
        slug: string,
        answer: Answer,
        change: Change = NOTE_REQUIRED
      ): Promise<void> {
        const { deps, save } = await fileSave(slug, answer, change);
        const review = await previewCollectionSave(deps, save);
        expect(review.notices).toEqual([noticeOf(change, answer)]);
        await writeCollectionSave(deps, save);
      }

      /** The same file save, written without its review first. */
      async function writtenWithout(
        slug: string,
        answer: Answer,
        change: Change
      ): Promise<void> {
        const { deps, save } = await fileSave(slug, answer, change);
        await writeCollectionSave(deps, save);
      }

      /**
       * The same change applied by the push, as the dialog's save has it applied where the push
       * carries values the file cannot: over the fields the registry records, answered as the
       * dialog answers.
       */
      async function throughPush(
        slug: string,
        translated: boolean,
        answer: Answer,
        change: Change = NOTE_REQUIRED
      ): Promise<void> {
        const [row] = await query<{ fields: unknown }>(
          `SELECT ${quote(dialect, "fields")} AS fields FROM ${quote(dialect, "dynamic_collections")} WHERE ${quote(dialect, "slug")} = '${slug}'`
        );
        const recorded: unknown =
          typeof row?.fields === "string"
            ? JSON.parse(row.fields)
            : row?.fields;
        await applyCollectionSchemaChange({
          slug,
          collection: { tableName: `dc_${slug}`, fields: recorded },
          fields: change.fields as unknown as FieldDefinition[],
          wasLocalized: translated,
          isLocalized: translated,
          status: false,
          wasStatus: false,
          renameResolutions: renamesOf(slug, translated, change),
          eventResolutions: [
            resolutionOf(slug, change, answer) as unknown as Resolution,
          ],
        });
      }

      /** `change` through `road`, answered with `answer`. */
      async function through(
        road: Road,
        slug: string,
        translated: boolean,
        answer: Answer,
        change: Change = NOTE_REQUIRED
      ): Promise<void> {
        if (road === "dialog")
          await throughDialog(slug, translated, answer, change);
        else if (road === "file") await throughFile(slug, answer, change);
        else await throughPush(slug, translated, answer, change);
      }

      /** The writer's dependencies and the save of `change` answered with `answer`. */
      async function fileSave(slug: string, answer: Answer, change: Change) {
        const deps = builderSaveDeps();
        if (deps === undefined) throw new Error("no Builder save writer");
        const definition = await loadUiSchema({
          projectRoot: deps.projectRoot,
          uiSchemaFile: deps.config.db.uiSchemaFile,
        });
        const previous = definition.collections.find(c => c.slug === slug);
        if (previous === undefined) throw new Error(`${slug} is not defined`);
        return {
          deps,
          save: {
            slug,
            previous,
            entity: {
              ...previous,
              fields: change.fields as unknown as UiSchemaEntity["fields"],
            },
            change: "update",
            resolutions: [{ column: change.field, ...answer }],
            ...(change.renames === undefined
              ? {}
              : { renamedFields: change.renames }),
          },
        };
      }

      /**
       * Each entry's value of `column` in the default language, by entry, as the tables hold it:
       * its default-language row's where the values are kept per language, its row's otherwise.
       */
      async function defaultLanguageValues(
        slug: string,
        translated: boolean,
        column: string
      ): Promise<Record<string, unknown>> {
        const rows = keptPerLanguage(translated)
          ? await query<{ id: unknown; value: unknown }>(
              `SELECT ${quote(dialect, "_parent")} AS id, ${quote(dialect, column)} AS value FROM ${quote(dialect, `dc_${slug}_locales`)} WHERE ${quote(dialect, "_locale")} = 'en'`
            )
          : await query<{ id: unknown; value: unknown }>(
              `SELECT ${quote(dialect, "id")} AS id, ${quote(dialect, column)} AS value FROM ${quote(dialect, `dc_${slug}`)}`
            );
        return Object.fromEntries(rows.map(row => [String(row.id), row.value]));
      }

      /**
       * A table of `holder` whose one row references entry `id` of `main`, refusing its delete: a
       * key the database enforces, as another table's relationship has.
       */
      async function holdEntry(
        holder: string,
        main: string,
        id: string
      ): Promise<void> {
        const q = (name: string) => quote(dialect, name);
        await query(
          `CREATE TABLE ${q(holder)} (${q("id")} VARCHAR(36) PRIMARY KEY, ${q("entry")} ${await idColumnType(main)}, FOREIGN KEY (${q("entry")}) REFERENCES ${q(main)} (${q("id")}) ON DELETE RESTRICT)`
        );
        await query(
          `INSERT INTO ${q(holder)} (${q("id")}, ${q("entry")}) VALUES ('h1', '${id}')`
        );
      }

      /** Keeps entry `id` of `main` through any DELETE of it, by a trigger of the database's own. */
      async function keepEntry(main: string, id: string): Promise<void> {
        const q = (name: string) => quote(dialect, name);
        if (dialect === "sqlite") {
          await query(
            `CREATE TRIGGER ${q(`${main}_keep`)} BEFORE DELETE ON ${q(main)} FOR EACH ROW WHEN OLD.id = '${id}' BEGIN SELECT RAISE(IGNORE); END`
          );
          return;
        }
        await query(
          `CREATE FUNCTION ${q(`${main}_keep`)}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF OLD.id = '${id}' THEN RETURN NULL; END IF; RETURN OLD; END $$`
        );
        await query(
          `CREATE TRIGGER ${q(`${main}_keep`)} BEFORE DELETE ON ${q(main)} FOR EACH ROW EXECUTE FUNCTION ${q(`${main}_keep`)}()`
        );
      }

      /** The type of `table`'s id column as the database declares it, for a key to match. */
      async function idColumnType(table: string): Promise<string> {
        if (dialect === "sqlite") return "TEXT";
        if (dialect === "postgresql") {
          const [row] = await query<{ type: string }>(
            `SELECT format_type(atttypid, atttypmod) AS type FROM pg_attribute WHERE attrelid = '${table}'::regclass AND attname = 'id'`
          );
          return row?.type ?? "TEXT";
        }
        const [row] = await query<{
          type: string;
          charset: string | null;
          collation: string | null;
        }>(
          `SELECT COLUMN_TYPE AS type, CHARACTER_SET_NAME AS charset, COLLATION_NAME AS collation FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}' AND COLUMN_NAME = 'id'`
        );
        return row?.charset
          ? `${row.type} CHARACTER SET ${row.charset} COLLATE ${row.collation}`
          : (row?.type ?? "VARCHAR(36)");
      }

      /**
       * Every language's row of the collection's entries: its entry, its language and its value in
       * `column`, the note's by default.
       */
      async function languageRows(
        slug: string,
        column = "note"
      ): Promise<{ parent: string; locale: string; value: unknown }[]> {
        const q = (name: string) => quote(dialect, name);
        const rows = await query<Record<string, unknown>>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q(column)} AS value FROM ${q(`dc_${slug}_locales`)}`
        );
        return rows
          .map(row => ({
            parent: String(row.parent),
            locale: String(row.locale),
            value: row.value ?? null,
          }))
          .sort((a, b) =>
            `${a.parent}:${a.locale}`.localeCompare(`${b.parent}:${b.locale}`)
          );
      }

      /**
       * Each language row's stamp, by `entry:language`, as the moment it names in milliseconds
       * (the runtime stores epoch seconds on SQLite, and a UTC moment elsewhere).
       */
      async function stampsOf(
        slug: string
      ): Promise<Record<string, number | null>> {
        const q = (name: string) => quote(dialect, name);
        const column = q("_updated_at");
        const milliseconds =
          dialect === "postgresql"
            ? `EXTRACT(EPOCH FROM ${column}) * 1000`
            : dialect === "mysql"
              ? `TIMESTAMPDIFF(MICROSECOND, '1970-01-01 00:00:00', ${column}) / 1000`
              : `${column} * 1000`;
        const rows = await query<Record<string, unknown>>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${milliseconds} AS stamp FROM ${q(`dc_${slug}_locales`)}`
        );
        return Object.fromEntries(
          rows.map(row => [
            `${String(row.parent)}:${String(row.locale)}`,
            row.stamp === null || row.stamp === undefined
              ? null
              : Number(row.stamp),
          ])
        );
      }

      /** The English row of `id` in the collection's translations table, its stamp as `what`. */
      async function stampRow<T>(
        slug: string,
        id: string,
        what: string
      ): Promise<T> {
        const q = (name: string) => quote(dialect, name);
        const [row] = await query<{ value: T }>(
          `SELECT ${what} AS value FROM ${q(`dc_${slug}_locales`)} WHERE ${q("_parent")} = '${id}' AND ${q("_locale")} = 'en'`
        );
        return row!.value;
      }

      /**
       * How a stamp is stored, as its type and the shape of its text: the integer SQLite keeps, the
       * DATETIME(3) MySQL keeps, the timestamptz PostgreSQL keeps.
       */
      async function stampForm(
        slug: string,
        id: string
      ): Promise<{ type: unknown; shape: string }> {
        const type =
          dialect === "sqlite"
            ? "typeof(_updated_at)"
            : dialect === "postgresql"
              ? "pg_typeof(_updated_at)::text"
              : "CAST(_updated_at AS CHAR)";
        const text = await stampText(slug, id);
        return {
          type:
            dialect === "mysql"
              ? "datetime(3)"
              : await stampRow<string>(slug, id, type),
          shape: text.replace(/\d/g, "9"),
        };
      }

      /** A stamp's text as the database prints it, precise to the millisecond. */
      const stampText = (slug: string, id: string): Promise<string> =>
        stampRow<unknown>(
          slug,
          id,
          dialect === "postgresql"
            ? "to_char(_updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.MS')"
            : dialect === "mysql"
              ? "LEFT(DATE_FORMAT(_updated_at, '%Y-%m-%d %H:%i:%s.%f'), 23)"
              : "_updated_at"
        ).then(String);

      /** An encoded stamp as the same text: SQLite's integer, and the moment to the millisecond. */
      const encodedText = (encoded: unknown): string =>
        dialect === "sqlite"
          ? String(encoded)
          : (encoded instanceof Date ? encoded.toISOString() : String(encoded))
              .replace("T", " ")
              .slice(0, 23);

      /**
       * That a change lost nothing: every entry is there, and where the values are kept per
       * language, every language's row with its value, as `before` read them under `column`.
       */
      async function expectNothingLost(
        slug: string,
        ids: { kept: string; empty: string; bare: string },
        before:
          | { parent: string; locale: string; value: unknown }[]
          | undefined,
        column = "note"
      ): Promise<void> {
        expect(await idsOf(`dc_${slug}`)).toEqual(
          [ids.kept, ids.empty, ids.bare].sort()
        );
        if (before !== undefined) {
          expect(await languageRows(slug, column)).toEqual(before);
        }
      }

      /** An error's messages, its causes' included, so a cause that names the key is read. */
      const messagesOf = (error: unknown): string =>
        error instanceof Error
          ? `${error.message}\n${messagesOf(error.cause)}`
          : "";

      /** `change` through `road`, not judged: its review is not read, and a refusal is thrown. */
      async function attempt(
        road: Road,
        slug: string,
        translated: boolean,
        answer: Answer
      ): Promise<void> {
        if (road === "file") {
          await writtenWithout(slug, answer, NOTE_REQUIRED);
        } else if (road === "push") {
          await throughPush(slug, translated, answer, NOTE_REQUIRED);
        } else {
          const response = await appliedThroughDialog(
            slug,
            translated,
            NOTE_REQUIRED.fields,
            { eventResolutions: [resolutionOf(slug, NOTE_REQUIRED, answer)] }
          );
          if (!response.ok) throw new Error(await response.text());
        }
      }

      /** The entries the collection's table holds, by id. */
      async function idsOf(table: string, column = "id"): Promise<string[]> {
        const rows = await query<Record<string, unknown>>(
          `SELECT ${quote(dialect, column)} AS id FROM ${quote(dialect, table)}`
        );
        return [...new Set(rows.map(row => String(row.id)))].sort();
      }

      for (const road of ROADS) {
        for (const translated of [false, true]) {
          const kind = translated ? "a translated" : "an untranslated";
          const slugOf = (answer: Answer) =>
            `${prefix}_${road === "dialog" ? "dlg" : road}_${translated ? "t" : "p"}_${answer.kind === "fill" ? "f" : "d"}`;

          it(`fills ${kind} collection's entries without a value in the default language (${road})`, async () => {
            const answer: Answer = { kind: "fill", value: "filled" };
            const slug = slugOf(answer);
            const ids = await notesWithEntries(slug, translated);

            await through(road, slug, translated, answer);

            expect(await readIn(slug, ids.kept, "en")).toMatchObject({
              note: "kept",
            });
            expect(await readIn(slug, ids.empty, "en")).toMatchObject({
              note: "filled",
            });
            expect(await readIn(slug, ids.bare, "en")).toMatchObject({
              note: "filled",
            });
            if (translated) {
              expect(await readIn(slug, ids.bare, "es")).toMatchObject({
                note: "nota",
              });
            }
          });

          it(`deletes ${kind} collection's entries without a value in the default language (${road})`, async () => {
            const answer: Answer = { kind: "delete_nonconforming" };
            const slug = slugOf(answer);
            const ids = await notesWithEntries(slug, translated);

            await through(road, slug, translated, answer);

            expect(await idsOf(`dc_${slug}`)).toEqual([ids.kept]);
            if (keptPerLanguage(translated)) {
              // Every language's row of a deleted entry goes with it.
              expect(await idsOf(`dc_${slug}_locales`, "_parent")).toEqual([
                ids.kept,
              ]);
            }
            expect(await readIn(slug, ids.kept, "en")).toMatchObject({
              note: "kept",
            });
          });

          it(`refuses an answer for ${kind} collection's text field the save leaves optional (${road})`, async () => {
            const answer: Answer = { kind: "delete_nonconforming" };
            const slug = `${slugOf(answer)}_opt`;
            const ids = await notesWithEntries(slug, translated);
            const optional: Change = {
              ...NOTE_REQUIRED,
              fields: [
                { name: "heading", type: "text" },
                { name: "note", type: "text" },
              ],
            };

            const before = keptPerLanguage(translated)
              ? await languageRows(slug)
              : undefined;

            if (road === "push") {
              // The push asks nothing of a field the change leaves optional, so it settles nothing.
              await throughPush(slug, translated, answer, optional);
              await expectNothingLost(slug, ids, before);
              return;
            }
            // The apply itself, not only its review, refuses it.
            const refused =
              road === "dialog"
                ? dispatchCollections(
                    {} as ServiceContainer,
                    "applySchemaChanges",
                    { collectionName: slug },
                    {
                      fields: optional.fields,
                      confirmed: true,
                      ...(translated ? { localized: true } : {}),
                      eventResolutions: [resolutionOf(slug, optional, answer)],
                      schemaVersion: await schemaVersionOf(
                        "dynamic_collections",
                        slug
                      ),
                    }
                  )
                : writtenWithout(slug, answer, optional);
            await expect(refused).rejects.toMatchObject({
              code: "VALIDATION_ERROR",
            });

            await expectNothingLost(slug, ids, before);
          });

          it(`fills a required field added to ${kind} collection in every entry's default language (${road})`, async () => {
            const answer: Answer = { kind: "fill", value: "summed" };
            const slug = `${slugOf(answer)}_new`;
            const ids = await notesWithEntries(slug, translated);

            await through(road, slug, translated, answer, SUMMARY_ADDED);

            // Read from the tables: the save's own file, run on its own, leaves the running
            // shape to the registry, which does not name the field yet.
            expect(
              await defaultLanguageValues(slug, translated, "summary")
            ).toEqual(
              Object.fromEntries(
                [ids.kept, ids.empty, ids.bare].map(id => [id, "summed"])
              )
            );
          });

          // A main-table column renamed and made required in one push is refused by the pipeline,
          // which takes no answer for a column it renames; the dialog's save of one runs its file.
          if (road !== "push" || keptPerLanguage(translated)) {
            it(`fills a text field of ${kind} collection renamed and made required in one save, counting the entries it leaves empty under its old name (${road})`, async () => {
              const answer: Answer = { kind: "fill", value: "filled" };
              const slug = `${slugOf(answer)}_ren`;
              const ids = await notesWithEntries(slug, translated);

              await through(
                road,
                slug,
                translated,
                answer,
                NOTE_RENAMED_REQUIRED
              );

              // The renamed values kept, the empty ones filled under the new name.
              expect(
                await defaultLanguageValues(slug, translated, "remark")
              ).toEqual({
                [ids.kept]: "kept",
                [ids.empty]: "filled",
                [ids.bare]: "filled",
              });
            });
          }

          // A field that leaves the main table for the translations table moves its values there
          // first, so its entries without a value are the ones whose main column was empty.
          if (keptPerLanguage(translated)) {
            it(`fills a shared text field of ${kind} collection joining the translations table and made required, counting its empty entries (${road})`, async () => {
              const answer: Answer = { kind: "fill", value: "filled" };
              const slug = `${slugOf(answer)}_join`;
              const ids = await sharedNotes(slug, translated);
              const joined: Change = {
                ...NOTE_REQUIRED,
                fields: [
                  { name: "heading", type: "text" },
                  { name: "note", type: "text", required: true },
                ],
              };

              await through(road, slug, translated, answer, joined);

              expect(
                await defaultLanguageValues(slug, translated, "note")
              ).toEqual({
                [ids.kept]: "kept",
                [ids.empty]: "filled",
                [ids.bare]: "filled",
              });
            });
          }

          // A date kept per language is stored in its column's own form, the moment the answer
          // names, whichever road writes it.
          if (keptPerLanguage(translated)) {
            it(`stores the date ${kind} collection's answer fills as its column stores one (${road})`, async () => {
              const answer: Answer = {
                kind: "fill",
                value: "2026-01-15T00:00:00.000Z",
              };
              const slug = `${slugOf(answer)}_date`;
              const fields = (required: boolean) => [
                { name: "heading", type: "text" },
                {
                  name: "published",
                  type: "date",
                  localized: true,
                  ...(required ? { required: true } : {}),
                },
              ];
              const created = await handler().createCollection({
                name: slug,
                label: "Note",
                localized: translated,
                fields: fields(false),
              });
              expect(created.success, JSON.stringify(created)).toBe(true);
              const write = async (data: Record<string, unknown>) => {
                const entry = await handler().getEntryService().createEntry(
                  {
                    collectionName: slug,
                    overrideAccess: true,
                    locale: "en",
                  },
                  data
                );
                expect(entry.success, JSON.stringify(entry)).toBe(true);
                return String((entry.data as { id: unknown }).id);
              };
              const undated = await write({ heading: "Undated" });
              // The same moment, as an ordinary write of the field stores it.
              const dated = await write({
                heading: "Dated",
                published: answer.value,
              });

              await through(road, slug, translated, answer, {
                fields: fields(true),
                field: "published",
                event: "add_not_null_with_nulls",
                without: 1,
              });

              // The stored form, not the value an API read makes of it: a read accepts an ISO text
              // too.
              const stored = async (id: string) => {
                const [row] = await query<{ value: unknown }>(
                  `SELECT ${quote(dialect, "published")} AS value FROM ${quote(dialect, `dc_${slug}_locales`)} WHERE ${quote(dialect, "_parent")} = '${id}' AND ${quote(dialect, "_locale")} = 'en'`
                );
                const value = row?.value;
                return value instanceof Date ? value.toISOString() : value;
              };
              expect(await stored(dated)).toBeDefined();
              expect(await stored(undated)).toEqual(await stored(dated));
            });
          }

          // A field kept per language has no NOT NULL to hold an entry without its value, so these
          // cases are its own; a column of the main table made required already holds none.
          if (keptPerLanguage(translated)) {
            it(`refuses an answer for ${kind} collection's required text field the save only renames (${road})`, async () => {
              const answer: Answer = { kind: "delete_nonconforming" };
              const slug = `${slugOf(answer)}_req`;
              const ids = await notesWithEntries(slug, translated);
              // Required first, with no answer: the dialog asks nothing for a field kept per
              // language, so the entries without a note stay as they are.
              const required = await appliedThroughDialog(
                slug,
                translated,
                NOTE_REQUIRED.fields,
                {}
              );
              expect(required.ok, await required.clone().text()).toBe(true);
              const before = await languageRows(slug);

              if (road === "push") {
                // The push renames the field, and asks nothing of it: no answer to a field the
                // change only renames is settled, and every language's value is under its new name.
                await throughPush(
                  slug,
                  translated,
                  answer,
                  NOTE_RENAMED_REQUIRED
                );
                await expectNothingLost(slug, ids, before, "remark");
                return;
              }
              {
                const refused =
                  road === "dialog"
                    ? appliedThroughDialog(
                        slug,
                        translated,
                        NOTE_RENAMED_REQUIRED.fields,
                        {
                          eventResolutions: [
                            resolutionOf(slug, NOTE_RENAMED_REQUIRED, answer),
                          ],
                          renameResolutions: renamesOf(
                            slug,
                            translated,
                            NOTE_RENAMED_REQUIRED
                          ),
                        }
                      ).then(async response => {
                        if (response.ok) return;
                        // The refusal's code, from the envelope the API answers with.
                        const body = (await response.json()) as {
                          error?: { code?: string };
                        };
                        throw { code: body.error?.code };
                      })
                    : writtenWithout(slug, answer, NOTE_RENAMED_REQUIRED);
                await expect(refused).rejects.toMatchObject({
                  code: "VALIDATION_ERROR",
                });
              }

              await expectNothingLost(slug, ids, before);
            });

            it(`keeps every language's row of ${kind} collection's entries whose delete the database refuses (${road})`, async () => {
              const answer: Answer = { kind: "delete_nonconforming" };
              const slug = `${slugOf(answer)}_held`;
              const ids = await notesWithEntries(slug, translated);
              // Another table holds one of the entries without a note, so the database refuses its
              // delete. Where the statements commit one at a time (MySQL), nothing deleted before
              // that refusal can be taken back.
              const holder = `${slug}_holds`;
              await holdEntry(holder, `dc_${slug}`, ids.empty);
              try {
                const before = await languageRows(slug);

                // The refusal is the holder's key, not another reason the save did not delete: the
                // database names it, or on SQLite's file road the reference the delete would leave.
                const refusal = await attempt(
                  road,
                  slug,
                  translated,
                  answer
                ).then(
                  () => undefined,
                  (error: unknown) => error
                );
                expect(refusal).toMatchObject({
                  code: "NEXTLY_MIGRATION_APPLY_FAILED",
                });
                expect(messagesOf(refusal)).toMatch(
                  /foreign key|referencing rows that do not exist/i
                );

                // Every entry still there keeps every language's row.
                const left = new Set(await idsOf(`dc_${slug}`));
                expect(left.has(ids.empty)).toBe(true);
                expect(
                  (await languageRows(slug)).filter(row => left.has(row.parent))
                ).toEqual(before.filter(row => left.has(row.parent)));
              } finally {
                await query(`DROP TABLE ${quote(dialect, holder)}`);
              }
            });

            // A trigger that keeps an entry keeps its language rows too: the translations rows go
            // only with an entry the database has removed. MySQL's triggers cannot keep a row.
            it.runIf(road === "push" && dialect !== "mysql")(
              `keeps every language's row of ${kind} collection's entry a trigger keeps (${road})`,
              async () => {
                const answer: Answer = { kind: "delete_nonconforming" };
                const slug = `${slugOf(answer)}_trig`;
                const ids = await notesWithEntries(slug, translated);
                const rows = async () =>
                  (await languageRows(slug)).filter(
                    row => row.parent === ids.empty || row.parent === ids.kept
                  );
                await keepEntry(`dc_${slug}`, ids.empty);
                const before = await rows();

                await throughPush(slug, translated, answer);

                // The entry the trigger kept is there with every language's row of it; the one
                // without a value that it let go is gone with its rows.
                expect(await idsOf(`dc_${slug}`)).toEqual(
                  [ids.empty, ids.kept].sort()
                );
                expect(await rows()).toEqual(before);
                expect(
                  (await languageRows(slug)).some(
                    row => row.parent === ids.bare
                  )
                ).toBe(false);
              }
            );

            it(`stamps the default-language rows a fill writes for ${kind} collection (${road})`, async () => {
              const answer: Answer = { kind: "fill", value: "filled" };
              const slug = `${slugOf(answer)}_stamp`;
              const ids = await notesWithEntries(slug, translated);
              // Every row stamped long ago, so a stamp the fill writes is told from it.
              await query(
                `UPDATE ${quote(dialect, `dc_${slug}_locales`)} SET ${quote(dialect, "_updated_at")} = ${LONG_AGO[dialect]}`
              );
              const before = await stampsOf(slug);

              await through(road, slug, translated, answer);

              const after = await stampsOf(slug);
              // Each row the fill wrote, the one it filled and the one it added, is there with a
              // moment later than the one seeded, and one of this moment.
              for (const id of [ids.empty, ids.bare]) {
                const stamp = after[`${id}:en`];
                expect(stamp).toBeDefined();
                expect(stamp).not.toBeNull();
                expect(stamp!).toBeGreaterThan(LONG_AGO_MS);
                expect(Math.abs(stamp! - Date.now())).toBeLessThan(600_000);
              }
              // Every other row keeps its stamp.
              expect(after[`${ids.kept}:en`]).toBe(before[`${ids.kept}:en`]);
              if (translated) {
                expect(after[`${ids.bare}:es`]).toBe(before[`${ids.bare}:es`]);
              }

              // An ordinary write stamps a row through the runtime's encoder (`encodeStamp`). The
              // stamp the fill wrote reads back in the same form, on every database.
              const written = await handler().getEntryService().updateEntry(
                {
                  collectionName: slug,
                  entryId: ids.kept,
                  overrideAccess: true,
                  locale: "en",
                },
                { heading: "Again", _overwrite: true }
              );
              expect(written.success, JSON.stringify(written)).toBe(true);
              const ordinary = await stampForm(slug, ids.kept);
              for (const id of [ids.empty, ids.bare]) {
                expect(await stampForm(slug, id)).toEqual(ordinary);
              }
              // And it is the form the encoder gives the moment the row holds.
              const at = (await stampsOf(slug))[`${ids.empty}:en`]!;
              const encoded = encodeStamp(
                new Date(at),
                `dc_${slug}_locales`,
                dialect
              );
              expect(await stampText(slug, ids.empty)).toBe(
                encodedText(encoded)
              );
            });
          }
        }
      }

      // Outside development, a Single's push settles a field kept per language itself. An optional
      // field's default on the main table reaches the row by the file alone, as before, so that
      // layout's Single is not asked it there.
      const environments =
        layout === "per-language"
          ? (["development", "production"] as const)
          : (["development"] as const);
      for (const environment of environments) {
        it(`gives a Single's document the default a text field it adds states (${environment})`, async () => {
          const slug = `${prefix}_site_${environment === "development" ? "dev" : "prod"}`;
          await dispatchSingles(
            "createSingle",
            {},
            {
              slug,
              label: "Site",
              fields: [{ name: "heading", type: "text" }],
            }
          );
          await current.nextly.updateSingle({
            slug,
            data: { heading: "Hello", _overwrite: true },
          });

          // Outside development the save writes its files and its push applies the change.
          vi.stubEnv("NODE_ENV", environment);
          await dispatchSingles(
            "applySingleSchemaChanges",
            { slug },
            {
              fields: [
                { name: "heading", type: "text" },
                { name: "tagline", type: "text", defaultValue: "Welcome" },
              ],
              confirmed: true,
              schemaVersion: await schemaVersionOf("dynamic_singles", slug),
            }
          );

          const read = (await current.nextly.findSingle({
            slug,
            locale: "en",
          } as never)) as Record<string, unknown>;
          expect(read).toMatchObject({ heading: "Hello", tagline: "Welcome" });
        });
      }

      // PostgreSQL's `now()` is the moment its transaction began; a fill's stamp is the moment its
      // statement runs, so a translation written while the transaction waited is older than it.
      it.runIf(dialect === "postgresql")(
        "stamps a fill with its statement's moment, later than its transaction's",
        async () => {
          const slug = `${prefix}_clock`;
          const ids = await notesWithEntries(slug, true);
          const fill = resolutionStatements(
            {
              kind: "fill",
              tableName: `dc_${slug}`,
              columnName: "note",
              value: "filled",
              perLanguage: {
                companionTable: `dc_${slug}_locales`,
                locale: "en",
              },
            },
            dialect
          );
          let began = 0;
          await (
            current.adapter as unknown as {
              transaction<T>(
                work: (tx: {
                  execute<R>(statement: string): Promise<R[]>;
                }) => Promise<T>
              ): Promise<T>;
            }
          ).transaction(async tx => {
            const [start] = await tx.execute<{ began: unknown }>(
              `SELECT EXTRACT(EPOCH FROM now()) * 1000 AS began`
            );
            began = Number(start?.began);
            await tx.execute("SELECT pg_sleep(0.5)");
            for (const statement of fill) await tx.execute(statement);
          });

          const stamps = await stampsOf(slug);
          for (const id of [ids.empty, ids.bare]) {
            expect(stamps[`${id}:en`]!).toBeGreaterThanOrEqual(began + 500);
          }
        }
      );

      it("stores a localized date a Single's push is given as its default as its file stores it", async () => {
        // A translated Single, so the date is kept per language on either layout.
        const stored = new Map<string, unknown>();
        for (const environment of ["development", "production"] as const) {
          const slug = `${prefix}_dated_${environment === "development" ? "dev" : "prod"}`;
          vi.stubEnv("NODE_ENV", "development");
          await dispatchSingles(
            "createSingle",
            {},
            {
              slug,
              label: "Dated",
              localized: true,
              fields: [{ name: "heading", type: "text" }],
            }
          );
          await current.nextly.updateSingle({
            slug,
            data: { heading: "Hello", _overwrite: true },
          });

          // In development the save's file is run; outside it, its push applies the change.
          vi.stubEnv("NODE_ENV", environment);
          await dispatchSingles(
            "applySingleSchemaChanges",
            { slug },
            {
              fields: [
                { name: "heading", type: "text" },
                {
                  name: "published",
                  type: "date",
                  localized: true,
                  defaultValue: "2026-01-15",
                },
              ],
              confirmed: true,
              schemaVersion: await schemaVersionOf("dynamic_singles", slug),
            }
          );
          vi.stubEnv("NODE_ENV", "development");

          const [row] = await query<{ value: unknown }>(
            `SELECT ${quote(dialect, "published")} AS value FROM ${quote(dialect, `single_${slug}_locales`)} WHERE ${quote(dialect, "_locale")} = 'en'`
          );
          stored.set(environment, row?.value);
        }

        // The value the push left is the one the file writes.
        const value = (v: unknown) =>
          v instanceof Date ? v.toISOString() : String(v);
        expect(stored.get("development")).toBeDefined();
        expect(stored.get("development")).not.toBeNull();
        expect(value(stored.get("production"))).toBe(
          value(stored.get("development"))
        );
      });
    }
  );
}
