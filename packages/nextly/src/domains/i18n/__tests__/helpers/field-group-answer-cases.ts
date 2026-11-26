/**
 * A field group's save that makes a text field required, answered for the instances that hold no
 * value for it, on per-language storage: the review counts the instances, and the save's push,
 * which applies it, settles them, filling them or deleting them as the answer says.
 *
 * A field group's save takes its push outside development for every change, and in development
 * where another change in the same save carries values (a number field turned to text here). The
 * first case for a road holds what the others are built on: the review, the save's answer and the
 * instances before it.
 *
 * Run on the layout the suite sets; a field group is kept per language under per-language storage
 * and not on the earlier one, so the suite is the per-language one.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { createScratchDatabase } from "../../../../__tests__/helpers/fresh-database";
import {
  defineCollection,
  defineConfig,
  fieldGroup,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { clearServices, shutdownServices } from "../../../../di/register";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { describeEachDialect } from "../../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../../shared/lib/env";

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };

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
}

/** Where the save's push applies the change: outside development, and in it, where it carries values. */
const ROADS = [
  "outside development",
  "in development, carrying values",
] as const;

export function fieldGroupAnswerCases(prefix: string): void {
  describeEachDialect(
    "a field group's answer for a field made required",
    dialect => {
      let folder: string;
      let adapter: DrizzleAdapter;
      let drop: (() => Promise<void>) | undefined;
      let current: TestNextly | undefined;

      beforeEach(async () => {
        folder = await mkdtemp(join(tmpdir(), "nextly-fg-answer-"));
        vi.stubEnv("NODE_ENV", "development");
        vi.stubEnv("DB_DIALECT", dialect);
        let url: string;
        if (dialect === "sqlite") {
          url = `file:${join(folder, "app.db")}`;
        } else {
          const scratch = await createScratchDatabase(dialect, "nextly_fga");
          url = scratch.url;
          drop = () => scratch.drop();
        }
        vi.stubEnv("DATABASE_URL", url);
        _resetEnvCache();
        adapter = (await createAdapter({
          type: dialect as TestDialect,
          url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      });

      afterEach(async () => {
        try {
          await current?.destroy();
          await shutdownServices();
          await adapter.disconnect();
        } finally {
          vi.unstubAllEnvs();
          _resetEnvCache();
          await drop?.();
          drop = undefined;
          current = undefined;
          await rm(folder, { recursive: true, force: true });
        }
      });

      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      /** Starts the app over the case's database, with `collections` defined in code. */
      async function start(
        collections: ReturnType<typeof defineCollection>[] = []
      ): Promise<TestNextly> {
        defineConfig({ collections });
        clearServices();
        current = await createTestNextly({
          adapter: adapter as never,
          collections,
          basePath: folder,
          localization: { locales: ["en", "es"], defaultLocale: "en" },
          db: DB,
        } as Parameters<typeof createTestNextly>[0]);
        return current;
      }

      /** An instance's values in one language. */
      type LanguageRow = { heading: unknown; note: unknown };

      /** The instances' rows in each language, by instance and language. */
      async function languageRows(): Promise<Record<string, LanguageRow>> {
        const rows = await adapter.executeQuery<
          { id: unknown; locale: unknown } & LanguageRow
        >(
          `SELECT ${q("_parent")} AS id, ${q("_locale")} AS locale, ${q("heading")} AS heading, ${q("note")} AS note FROM ${q(`comp_${prefix}_card_locales`)}`
        );
        return Object.fromEntries(
          rows.map(row => [
            `${String(row.id)} ${String(row.locale)}`,
            { heading: row.heading ?? null, note: row.note ?? null },
          ])
        );
      }

      /** Each instance's own row, as the number its `views` reads as, whichever type holds it. */
      async function viewsOf(): Promise<Record<string, number>> {
        const rows = await adapter.executeQuery<{
          id: unknown;
          views: unknown;
        }>(
          `SELECT ${q("id")} AS id, ${q("views")} AS views FROM ${q(`comp_${prefix}_card`)}`
        );
        return Object.fromEntries(
          rows.map(row => [String(row.id), Number(row.views)])
        );
      }

      async function pageCount(): Promise<number> {
        const rows = await adapter.executeQuery<{ id: unknown }>(
          `SELECT ${q("id")} AS id FROM ${q(`dc_${prefix}_pages`)}`
        );
        return rows.length;
      }

      /** The save `road` reaches, with `answer`; what the review and the save answered. */
      async function answered(
        road: (typeof ROADS)[number],
        answer: "fill" | "delete" = "fill"
      ): Promise<{
        notices: string[];
        applied: boolean;
        before: Record<string, LanguageRow>;
        empty: string;
        kept: string;
      }> {
        const slug = `${prefix}_card`;
        await start();
        await dispatchComponents(
          "createComponent",
          {},
          {
            slug,
            label: "Card",
            fields: [
              { name: "heading", type: "text" },
              { name: "note", type: "text" },
              { name: "views", type: "number", localized: false },
            ],
          }
        );
        const app = await start([
          defineCollection({
            slug: `${prefix}_pages`,
            fields: [
              text({ name: "title" }),
              fieldGroup({ name: "one", component: slug }),
            ],
          }),
        ]);
        const entries = (
          app.getService("collectionsHandler") as unknown as {
            getEntryService(): Entries;
          }
        ).getEntryService();
        const collectionName = `${prefix}_pages`;
        const write = async (
          english: Record<string, unknown>,
          spanish: Record<string, unknown>
        ) => {
          const created = await entries.createEntry(
            { collectionName, overrideAccess: true, locale: "en" },
            { title: "P", one: english }
          );
          expect(created.success, JSON.stringify(created)).toBe(true);
          const translated = await entries.updateEntry(
            {
              collectionName,
              entryId: String((created.data as { id: unknown }).id),
              overrideAccess: true,
              locale: "es",
            },
            // The language's first write: nothing earlier of it to have lost.
            { one: spanish, _overwrite: true }
          );
          expect(translated.success, JSON.stringify(translated)).toBe(true);
        };
        await write(
          { heading: "A", note: "kept", views: 1 },
          { heading: "Hola", note: "guardada", views: 1 }
        );
        // A note in Spanish alone: the default language is the one that needs it.
        await write(
          { heading: "B", views: 2 },
          { heading: "Adios", note: "nota", views: 2 }
        );
        const before = await languageRows();
        const idWith = (heading: string) =>
          Object.keys(before)
            .find(key => before[key]?.heading === heading)
            ?.split(" ")[0] ?? "";
        const kept = idWith("A");
        const empty = idWith("B");
        // What each case stands on: two instances, each in both languages, one with no note in the
        // default language.
        expect(before).toEqual({
          [`${kept} en`]: { heading: "A", note: "kept" },
          [`${kept} es`]: { heading: "Hola", note: "guardada" },
          [`${empty} en`]: { heading: "B", note: null },
          [`${empty} es`]: { heading: "Adios", note: "nota" },
        });

        const carriesValues = road !== "outside development";
        const version = (await app
          .getService("fieldGroupRegistryService")
          .getComponent(slug)) as { schemaVersion?: number };
        const body = {
          fields: [
            { name: "heading", type: "text" },
            { name: "note", type: "text", required: true },
            carriesValues
              ? { name: "views", type: "text", localized: false }
              : { name: "views", type: "number", localized: false },
          ],
          confirmed: true,
          schemaVersion: version.schemaVersion,
          eventResolutions: [
            {
              eventId: `add_not_null_with_nulls:comp_${slug}.note`,
              ...(answer === "fill"
                ? { kind: "provide_default", value: "filled" }
                : { kind: "delete_nonconforming" }),
            },
          ],
        };
        const preview = (await dispatchComponents(
          "previewComponentSchemaChanges",
          { slug },
          body
        )) as unknown as Response;
        const reviewed = (await preview.json()) as {
          notices?: string[];
          data?: { notices?: string[] };
        };
        vi.stubEnv("NODE_ENV", carriesValues ? "development" : "production");
        const applied = (await dispatchComponents(
          "applyComponentSchemaChanges",
          { slug },
          body
        )) as unknown as Response;
        return {
          notices: (reviewed.data ?? reviewed).notices ?? [],
          applied: applied.ok,
          before,
          empty,
          kept,
        };
      }

      for (const road of ROADS) {
        it(`reviews the answer and saves (${road})`, async () => {
          const result = await answered(road);

          expect(result.notices).toEqual([
            "This save fills 1 row with 'filled' in note.",
          ]);
          expect(result.applied).toBe(true);
        }, 120_000);

        it(`fills the instance the review named, and no other (${road})`, async () => {
          const { before, empty } = await answered(road);

          expect(await languageRows()).toEqual({
            ...before,
            [`${empty} en`]: { heading: "B", note: "filled" },
          });
        }, 120_000);

        it(`deletes the instance with no value, and no other (${road})`, async () => {
          const { applied, before, kept } = await answered(road, "delete");

          expect(applied).toBe(true);
          // The instance's own row, then its language rows; the kept instance's stay, as do the
          // pages both were on.
          expect(await viewsOf()).toEqual({ [kept]: 1 });
          expect(await languageRows()).toEqual({
            [`${kept} en`]: before[`${kept} en`],
            [`${kept} es`]: before[`${kept} es`],
          });
          expect(await pageCount()).toBe(2);
        }, 120_000);
      }
    }
  );
}
