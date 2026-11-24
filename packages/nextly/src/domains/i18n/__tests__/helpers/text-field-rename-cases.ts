/**
 * A text field renamed through the Schema Builder's dialog keeps its values, wherever they are kept:
 * the preview offers the rename where the values live (the translations table under per-language
 * storage or for a translated collection, the main table otherwise), and the apply, given that
 * answer back as the dialog sends it, carries every language's value to the new name.
 *
 * Shared by the suite on the earlier layout and the one on per-language storage, as every
 * installation runs it, so both layouts answer the same cases. Each dialog save takes the road the
 * dispatcher picks for it: the migration file of an untranslated collection on the earlier layout,
 * the push (with its translations table brought in step) otherwise.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";

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

/** A rename candidate as the preview's body names it (`toRenameCandidateWire`). */
interface OfferedRename {
  table: string;
  from: string;
  to: string;
}

const quote = (dialect: TestDialect, name: string) =>
  dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

/**
 * The cases, for `layout`, with each collection named from `prefix` so the two suites never share a
 * table.
 */
export function textFieldRenameCases(
  layout: "earlier" | "per-language",
  prefix: string
): void {
  describeEachDialect(
    `a text field renamed in the Builder (${layout} layout)`,
    dialect => {
      let current: TestNextly;

      beforeEach(async () => {
        // The Builder's apply runs its change in development only.
        vi.stubEnv("NODE_ENV", "development");
        current = await createTestNextly({
          dialect,
          collections: [],
          localization: { locales: ["en", "es"], defaultLocale: "en" },
        });
      });

      afterEach(async () => {
        await current.destroy();
        vi.unstubAllEnvs();
      });

      const handler = () =>
        current.getService(
          "collectionsHandler"
        ) as unknown as CollectionsHandler;

      async function schemaVersionOf(slug: string): Promise<number> {
        const [row] = await (
          current.adapter as unknown as {
            executeQuery<R>(statement: string): Promise<R[]>;
          }
        ).executeQuery<{ version: number | string | null }>(
          `SELECT ${quote(dialect, "schema_version")} AS version FROM ${quote(dialect, "dynamic_collections")} WHERE ${quote(dialect, "slug")} = '${slug}'`
        );
        return Number(row?.version ?? 1);
      }

      /** The field's value in `locale`, read as an editor reads the entry. */
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

      for (const translated of [false, true]) {
        it(`keeps every value of ${translated ? "a translated" : "an untranslated"} collection's text field`, async () => {
          const slug = `${prefix}_${translated ? "translated" : "plain"}`;
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
          const entry = await entries.createEntry(
            { collectionName: slug, overrideAccess: true, locale: "en" },
            { heading: "Hello", note: "kept" }
          );
          expect(entry.success, JSON.stringify(entry)).toBe(true);
          const id = String((entry.data as { id: unknown }).id);
          if (translated) {
            const spanish = await entries.updateEntry(
              {
                collectionName: slug,
                entryId: id,
                overrideAccess: true,
                locale: "es",
              },
              // The language's first write: nothing earlier of it to have lost.
              { heading: "Hola", _overwrite: true }
            );
            expect(spanish.success, JSON.stringify(spanish)).toBe(true);
          }

          const fields = [
            { name: "headline", type: "text" },
            { name: "note", type: "text" },
          ];
          // The dialog's preview: the rename is offered on the table its values are kept in.
          const preview = (await dispatchCollections(
            {} as ServiceContainer,
            "previewSchemaChanges",
            { collectionName: slug },
            { fields }
          )) as unknown as Response;
          const body = (await preview.json()) as {
            renamed?: OfferedRename[];
            data?: { renamed?: OfferedRename[] };
          };
          const offered = (body.data ?? body).renamed ?? [];
          const keptPerLanguage = layout === "per-language" || translated;
          expect(offered).toEqual([
            expect.objectContaining({
              table: keptPerLanguage ? `dc_${slug}_locales` : `dc_${slug}`,
              from: "heading",
              to: "headline",
            }),
          ]);

          // The dialog answers the offer as a rename, and the apply keeps every value.
          const applied = (await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: slug },
            {
              fields,
              confirmed: true,
              ...(translated ? { localized: true } : {}),
              renameResolutions: offered.map(candidate => ({
                tableName: candidate.table,
                fromColumn: candidate.from,
                toColumn: candidate.to,
                choice: "rename",
              })),
              schemaVersion: await schemaVersionOf(slug),
            }
          )) as unknown as Response;
          expect(applied.ok, await applied.clone().text()).toBe(true);

          expect(await readIn(slug, id, "en")).toMatchObject({
            headline: "Hello",
            note: "kept",
          });
          if (translated) {
            expect(await readIn(slug, id, "es")).toMatchObject({
              headline: "Hola",
            });
          }
        });
      }
    }
  );
}
