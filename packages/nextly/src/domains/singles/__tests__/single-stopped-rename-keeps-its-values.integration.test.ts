/**
 * A translated Single field renamed as it leaves translation, in a schema save
 * stopped between its main-table step and the step that moves the values out
 * of the translations table, keeps every language readable: the stopped save
 * is reported as failed and leaves the registry as it was, so the field still
 * reads from its translations, and saving again finishes the move.
 *
 * Without that, the registry named the new shared field after the stop while
 * its column on the main table was empty and the values were still in the
 * translations table under the old name: every language read nothing.
 *
 * On MySQL each schema statement commits as it runs, so a save stopped after
 * its main-table step is part-way, which a different rule settles; that
 * dialect is not asserted here.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { SingleEntryService } from "../services/single-entry-service";

// The stop: the step after the main table's, failing once, as a process stopped there would.
const companionStop = vi.hoisted(() => ({ armed: false }));
vi.mock("../services/reconcile-single-companion", async importOriginal => {
  const actual =
    await importOriginal<
      typeof import("../services/reconcile-single-companion")
    >();
  return {
    ...actual,
    reconcileSingleCompanion: async (
      ...args: Parameters<typeof actual.reconcileSingleCompanion>
    ) => {
      if (companionStop.armed) {
        companionStop.armed = false;
        throw new Error("stopped between the main table and the companion");
      }
      return actual.reconcileSingleCompanion(...args);
    },
  };
});

const localization = { locales: ["en", "es"], defaultLocale: "en" };

describeEachDialect(
  "a Single's rename leaving translation, stopped part-way",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The Builder's save runs its migration in development only.
      vi.stubEnv("NODE_ENV", "development");
      current = await createTestNextly({
        dialect,
        collections: [],
        localization,
      });
    });

    afterEach(async () => {
      companionStop.armed = false;
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

    /** The names of the fields the registry records for `hero`, in order. */
    async function registeredFieldNames(): Promise<string[]> {
      const [row] = await query<{ fields: unknown }>(
        `SELECT ${q("fields")} AS fields FROM ${q("dynamic_singles")} WHERE ${q("slug")} = 'hero'`
      );
      const fields = (
        typeof row?.fields === "string" ? JSON.parse(row.fields) : row?.fields
      ) as { name: string }[];
      return fields.map(field => field.name);
    }

    const singles = (): SingleEntryService =>
      current.getService("singleEntryService");

    /** `field` as `hero`'s document reads it in `locale`. */
    async function read(field: string, locale: string): Promise<unknown> {
      const found = await singles().get("hero", {
        overrideAccess: true,
        locale,
      });
      return (found.data as Record<string, unknown> | undefined)?.[field];
    }

    /** What the archive keeps of `hero` in `locale`. */
    async function archivedIn(locale: string): Promise<unknown[]> {
      if (!(await current.adapter.tableExists("nextly_i18n_archive"))) {
        return [];
      }
      const rows = await query<{ value: unknown }>(
        `SELECT ${q("value")} AS value FROM ${q("nextly_i18n_archive")} WHERE ${q("collection")} = 'hero' AND ${q("locale")} = '${locale}'`
      );
      return rows.map(row => row.value);
    }

    /** The Builder's schema save, as the dispatcher makes it: the error it was refused with, or undefined. */
    function save(fields: Record<string, unknown>[]): Promise<unknown> {
      return dispatchSingles(
        "updateSingleSchema",
        { slug: "hero" },
        { fields, localized: true }
      ).then(
        () => undefined,
        (error: unknown) => error
      );
    }

    it.skipIf(dialect === "mysql")(
      "keeps every language readable after the stop, and saving again finishes the move",
      async () => {
        await dispatchSingles(
          "createSingle",
          {},
          {
            slug: "hero",
            label: "Hero",
            localized: true,
            fields: [
              { name: "heading", type: "text", localized: true },
              { name: "body", type: "text" },
            ],
          }
        );
        for (const [locale, heading] of [
          ["en", "Kept"],
          ["es", "Guardado"],
        ] as const) {
          const written = await singles().update(
            "hero",
            { heading, _overwrite: true },
            { overrideAccess: true, locale }
          );
          expect(written.success, JSON.stringify(written)).toBe(true);
        }
        const leaving = [
          { name: "headline", type: "text", localized: false },
          { name: "body", type: "text" },
        ];

        companionStop.armed = true;
        const stopped = await save(leaving);

        expect(companionStop.armed, "the stop was reached").toBe(false);
        expect(
          stopped,
          "the stopped save was reported as going through"
        ).toBeDefined();
        // As it was before the save: the field is still translated, and reads from its
        // translations in every language.
        expect(await registeredFieldNames()).toEqual(["heading", "body"]);
        expect(await read("heading", "en")).toBe("Kept");
        expect(await read("heading", "es")).toBe("Guardado");

        const again = await save(leaving);

        expect(again).toBeUndefined();
        expect(await registeredFieldNames()).toEqual(["headline", "body"]);
        // The default language's value is the shared field's now, and the other language's is
        // kept in the archive.
        expect(await read("headline", "en")).toBe("Kept");
        expect(await archivedIn("es")).toEqual(["Guardado"]);
      }
    );
  }
);
