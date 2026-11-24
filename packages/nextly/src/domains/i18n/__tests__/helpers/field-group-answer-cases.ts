/**
 * A field group's save that makes a text field required, answered with a fill for the instances
 * that hold no value for it, on per-language storage: the review counts the instances, and the
 * save's push, which applies it, settles them.
 *
 * A field group's save takes its push outside development for every change, and in development
 * where another change in the same save carries values (a number field turned to text here). The
 * two cases for a road are told apart: the first holds what the case is built on (the review, the
 * save's answer and the instances before it); the second, marked as waiting (`it.fails`), is the
 * instance's value after it, which the push leaves as it was today. A fixture that broke would fail
 * the first.
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

      /** Each instance's note in English, by entry. */
      async function notesOf(): Promise<Record<string, unknown>> {
        const rows = await adapter.executeQuery<{ id: unknown; note: unknown }>(
          `SELECT ${q("_parent")} AS id, ${q("note")} AS note FROM ${q(`comp_${prefix}_card_locales`)} WHERE ${q("_locale")} = 'en'`
        );
        return Object.fromEntries(
          rows.map(row => [String(row.id), row.note ?? null])
        );
      }

      /** The save `road` reaches, with the answer; what the review and the save answered. */
      async function answered(road: (typeof ROADS)[number]): Promise<{
        notices: string[];
        applied: boolean;
        before: Record<string, unknown>;
        empty: string;
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
        const write = async (one: Record<string, unknown>) =>
          app.nextly.create({
            collection: `${prefix}_pages` as never,
            data: { title: "P", one } as never,
          });
        await write({ heading: "A", note: "kept", views: 1 });
        await write({ heading: "B", views: 2 });
        const before = await notesOf();
        const empty = Object.keys(before).find(id => before[id] === null)!;

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
              kind: "provide_default",
              eventId: `add_not_null_with_nulls:comp_${slug}.note`,
              value: "filled",
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
        };
      }

      for (const road of ROADS) {
        it(`reviews the answer and saves (${road})`, async () => {
          const result = await answered(road);

          expect(result.notices).toEqual([
            "This save fills 1 row with 'filled' in note.",
          ]);
          expect(result.applied).toBe(true);
          // What the case stands on: two instances, one with no note, and its value is known.
          expect(Object.keys(result.before)).toHaveLength(2);
          expect(result.before[result.empty]).toBeNull();
        }, 120_000);

        // Waiting: the push settles no answer of a field group today.
        it.fails(
          `fills the instance the review named (${road})`,
          async () => {
            const { empty } = await answered(road);

            expect((await notesOf())[empty]).toBe("filled");
          },
          120_000
        );
      }
    }
  );
}
