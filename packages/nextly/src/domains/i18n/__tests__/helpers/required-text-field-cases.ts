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

      /** A save's change, the field it settles, and how many entries hold no value for it. */
      interface Change {
        fields: Record<string, unknown>[];
        field: string;
        /** The event the dialog's typed answer names, as the main table's column. */
        event: "add_not_null_with_nulls" | "add_required_field_no_default";
        without: number;
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

        const applied = (await dispatchCollections(
          {} as ServiceContainer,
          "applySchemaChanges",
          { collectionName: slug },
          {
            fields: change.fields,
            confirmed: true,
            ...(translated ? { localized: true } : {}),
            ...answers,
            schemaVersion: await schemaVersionOf("dynamic_collections", slug),
          }
        )) as unknown as Response;
        expect(applied.ok, await applied.clone().text()).toBe(true);
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
          renameResolutions: [],
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
    }
  );
}
