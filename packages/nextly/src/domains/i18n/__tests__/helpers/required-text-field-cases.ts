/**
 * A text field made required in the Schema Builder, answered with a fill or a delete for the
 * entries that hold no value for it, settles exactly those entries wherever the values are kept:
 * the main table on the earlier layout, the translations table's default-language rows under
 * per-language storage or for a translated collection. An entry with no value in the default
 * language, its default-language row there and empty or missing altogether, is filled there or
 * deleted with every language's row; an entry that has the value keeps it, and a value in another
 * language is kept.
 *
 * Both roads a save takes are covered: the dialog's apply, which takes the road the dispatcher
 * picks (the migration file of an untranslated collection on the earlier layout, the push with its
 * translations table brought in step otherwise), and the save's own migration file, run as
 * `nextly migrate` runs it on a deploy. The review counts the entries each answer settles.
 *
 * A Single's dialog save that adds a text field stating a default gives the Single's document that
 * default in the default language, wherever the field's values are kept.
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
import type { ServiceContainer } from "../../../../services";
import {
  previewCollectionSave,
  writeCollectionSave,
} from "../../../schema/builder-save/collection-save";
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
        const deps = builderSaveDeps();
        expect(deps).toBeDefined();
        if (deps === undefined) return;
        const definition = await loadUiSchema({
          projectRoot: deps.projectRoot,
          uiSchemaFile: deps.config.db.uiSchemaFile,
        });
        const previous = definition.collections.find(c => c.slug === slug);
        expect(previous).toBeDefined();
        if (previous === undefined) return;
        const save = {
          slug,
          previous,
          entity: {
            ...previous,
            fields: change.fields as unknown as UiSchemaEntity["fields"],
          },
          change: "update",
          resolutions: [{ column: change.field, ...answer }],
        };
        const review = await previewCollectionSave(deps, save);
        expect(review.notices).toEqual([noticeOf(change, answer)]);
        await writeCollectionSave(deps, save);
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

      for (const road of ["dialog", "file"] as const) {
        for (const translated of [false, true]) {
          const kind = translated ? "a translated" : "an untranslated";
          const slugOf = (answer: Answer) =>
            `${prefix}_${road === "dialog" ? "dlg" : "file"}_${translated ? "t" : "p"}_${answer.kind === "fill" ? "f" : "d"}`;

          it(`fills ${kind} collection's entries without a value in the default language (${road})`, async () => {
            const answer: Answer = { kind: "fill", value: "filled" };
            const slug = slugOf(answer);
            const ids = await notesWithEntries(slug, translated);

            if (road === "dialog")
              await throughDialog(slug, translated, answer);
            else await throughFile(slug, answer);

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

            if (road === "dialog")
              await throughDialog(slug, translated, answer);
            else await throughFile(slug, answer);

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

          it(`fills a required field added to ${kind} collection in every entry's default language (${road})`, async () => {
            const answer: Answer = { kind: "fill", value: "summed" };
            const slug = `${slugOf(answer)}_new`;
            const ids = await notesWithEntries(slug, translated);

            if (road === "dialog")
              await throughDialog(slug, translated, answer, SUMMARY_ADDED);
            else await throughFile(slug, answer, SUMMARY_ADDED);

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

      it("gives a Single's document the default a text field it adds states", async () => {
        const slug = `${prefix}_site`;
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
  );
}
