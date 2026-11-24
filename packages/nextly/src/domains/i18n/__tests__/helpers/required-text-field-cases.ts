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
import { applyCollectionSchemaChange } from "../../../schema/services/collection-schema-apply";
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

/** A stamp long before any test runs, as each dialect's `_updated_at` column takes it. */
const LONG_AGO: Record<TestDialect, string> = {
  sqlite: "1",
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
        await current.destroy();
        vi.unstubAllEnvs();
        await rm(basePath, { recursive: true, force: true });
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
      const noticeOf = (change: Change, answer: Answer) =>
        answer.kind === "fill"
          ? `This save fills ${change.without} rows with '${answer.value}' in ${change.field}.`
          : `This save also deletes ${change.without} rows here, and the rows that don't fit on every database the migration reaches.`;

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

      /** Every language's row of the collection's entries: its entry, language and note. */
      async function languageRows(
        slug: string
      ): Promise<{ parent: string; locale: string; note: unknown }[]> {
        const q = (name: string) => quote(dialect, name);
        const rows = await query<Record<string, unknown>>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q("note")} AS note FROM ${q(`dc_${slug}_locales`)}`
        );
        return rows
          .map(row => ({
            parent: String(row.parent),
            locale: String(row.locale),
            note: row.note ?? null,
          }))
          .sort((a, b) =>
            `${a.parent}:${a.locale}`.localeCompare(`${b.parent}:${b.locale}`)
          );
      }

      /** Each language row's stamp, by `entry:language`, as the database returns it. */
      async function stampsOf(
        slug: string
      ): Promise<Record<string, string | null>> {
        const q = (name: string) => quote(dialect, name);
        const rows = await query<Record<string, unknown>>(
          `SELECT ${q("_parent")} AS parent, ${q("_locale")} AS locale, ${q("_updated_at")} AS stamp FROM ${q(`dc_${slug}_locales`)}`
        );
        return Object.fromEntries(
          rows.map(row => [
            `${String(row.parent)}:${String(row.locale)}`,
            row.stamp === null || row.stamp === undefined
              ? null
              : row.stamp instanceof Date
                ? row.stamp.toISOString()
                : String(row.stamp),
          ])
        );
      }

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

            if (road === "push") {
              // The push asks nothing of a field the change leaves optional, so it settles nothing.
              await throughPush(slug, translated, answer, optional);
              expect(await idsOf(`dc_${slug}`)).toEqual(
                [ids.kept, ids.empty, ids.bare].sort()
              );
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

            // Nothing was deleted.
            expect(await idsOf(`dc_${slug}`)).toEqual(
              [ids.kept, ids.empty, ids.bare].sort()
            );
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

              if (road === "push") {
                // The push asks nothing of a field the change only renames, so it settles nothing.
                await throughPush(
                  slug,
                  translated,
                  answer,
                  NOTE_RENAMED_REQUIRED
                );
              } else {
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

              // Nothing was deleted.
              expect(await idsOf(`dc_${slug}`)).toEqual(
                [ids.kept, ids.empty, ids.bare].sort()
              );
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

                await attempt(road, slug, translated, answer).catch(
                  () => undefined
                );

                // Every entry still there keeps every language's row.
                const left = new Set(await idsOf(`dc_${slug}`));
                expect(
                  (await languageRows(slug)).filter(row => left.has(row.parent))
                ).toEqual(before.filter(row => left.has(row.parent)));
              } finally {
                await query(`DROP TABLE ${quote(dialect, holder)}`);
              }
            });

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
              // The rows the fill wrote carry a stamp of their own: the one it filled and the one
              // it added.
              for (const id of [ids.empty, ids.bare]) {
                expect(after[`${id}:en`]).not.toBeNull();
                expect(after[`${id}:en`]).not.toBe(before[`${id}:en`]);
              }
              // Every other row keeps its stamp.
              expect(after[`${ids.kept}:en`]).toBe(before[`${ids.kept}:en`]);
              if (translated) {
                expect(after[`${ids.bare}:es`]).toBe(before[`${ids.bare}:es`]);
              }
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
        expect(value(stored.get("production"))).toBe(
          value(stored.get("development"))
        );
      });
    }
  );
}
