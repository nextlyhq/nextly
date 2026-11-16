/**
 * A translated Single's or field group's Builder save that moves no values runs its own migration
 * file, which changes the companion `<table>_locales` too; the companion step that runs after it
 * then finds the companion already in step and plans nothing, so no statement runs twice. A field
 * renamed while translated keeps every language's value.
 *
 * Every plan the companion step makes is recorded (`buildCompanionTransitionStatements`): a save
 * the push applied instead would plan the companion's change itself, as the push leaves the
 * companion alone.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type * as ReconcileCompanion from "../../../i18n/migration/reconcile-companion";

/** Every companion plan made since the last reset. */
const plans = vi.hoisted(
  () => [] as { statements: string[]; beforeMain?: string[] }[]
);

vi.mock("../../../i18n/migration/reconcile-companion", async importOriginal => {
  const actual = await importOriginal<typeof ReconcileCompanion>();
  return {
    ...actual,
    buildCompanionTransitionStatements: (
      ...args: Parameters<typeof actual.buildCompanionTransitionStatements>
    ) => {
      const plan = actual.buildCompanionTransitionStatements(...args);
      plans.push(plan);
      return plan;
    },
  };
});

const DB = { migrationsDir: "./migrations", uiSchemaFile: "./ui-schema.json" };
const LOCALIZATION = { locales: ["en", "es"], defaultLocale: "en" };

type Field = Record<string, unknown>;
const TRANSLATED: Field[] = [
  { name: "heading", type: "text", localized: true },
  { name: "views", type: "number", localized: false },
];

interface Kind {
  name: string;
  table: string;
  registry: string;
  slug: string;
  create(): Promise<unknown>;
  save(fields: Field[], renameResolutions?: unknown[]): Promise<unknown>;
  /** Stores `heading` in each language, as the entity's own writes store it. */
  seed(t: TestNextly): Promise<string>;
}

for (const dialect of getConfiguredTestDialects()) {
  describe(`a translated Builder save that moves no values (${dialect})`, () => {
    let t: TestNextly;
    let basePath: string;

    beforeEach(async () => {
      basePath = await mkdtemp(join(tmpdir(), "nextly-companion-after-file-"));
      // The Builder's save runs its change in development only.
      vi.stubEnv("NODE_ENV", "development");
      t = await createTestNextly({
        dialect: dialect as TestDialect,
        basePath,
        db: DB,
        localization: LOCALIZATION,
      });
    });

    afterEach(async () => {
      await t?.destroy();
      vi.unstubAllEnvs();
      await rm(basePath, { recursive: true, force: true });
    });

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
    const exec = <T>(statement: string): Promise<T[]> =>
      (
        t.adapter as unknown as {
          executeQuery<R>(sql: string): Promise<R[]>;
        }
      ).executeQuery<T>(statement);
    const schemaVersionOf = async (registry: string, slug: string) => {
      const [row] = await exec<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    };
    /** Each language's value of one companion column. */
    const companionValues = async (table: string, column: string) =>
      Object.fromEntries(
        (
          await exec<{ locale: string; value: unknown }>(
            `SELECT ${q("_locale")} AS locale, ${q(column)} AS value FROM ${q(`${table}_locales`)}`
          )
        ).map(row => [row.locale, row.value])
      );

    const KINDS: Kind[] = [
      {
        name: "a Single",
        table: "single_hero",
        registry: "dynamic_singles",
        slug: "hero",
        create: () =>
          dispatchSingles(
            "createSingle",
            {},
            { slug: "hero", label: "Hero", localized: true, fields: TRANSLATED }
          ),
        save: async (fields, renameResolutions = []) =>
          dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "hero" },
            {
              fields,
              confirmed: true,
              localized: true,
              renameResolutions,
              schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
            }
          ),
        seed: async () => {
          for (const [locale, heading] of [
            ["en", "Hello"],
            ["es", "Hola"],
          ]) {
            await t.nextly.updateSingle({
              slug: "hero",
              locale,
              data: { heading, views: 7, _overwrite: true },
            } as never);
          }
          return "hero";
        },
      },
      {
        name: "a field group",
        table: "comp_banner",
        registry: "dynamic_components",
        slug: "banner",
        create: () =>
          dispatchComponents(
            "createComponent",
            {},
            {
              slug: "banner",
              label: "Banner",
              localized: true,
              fields: TRANSLATED,
            }
          ),
        save: async (fields, renameResolutions = []) =>
          dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "banner" },
            {
              fields,
              confirmed: true,
              localized: true,
              renameResolutions,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "banner"
              ),
            }
          ),
        seed: async () => {
          await exec(
            `INSERT INTO ${q("comp_banner")} (${["id", "_parent_id", "_parent_table", "_parent_field", "views"].map(q).join(", ")}) VALUES ('banner-1', 'entry-1', 'dc_pages', 'banner', 7)`
          );
          await exec(
            `INSERT INTO ${q("comp_banner_locales")} (${["_parent", "_locale", "heading"].map(q).join(", ")}) VALUES ('banner-1', 'en', 'Hello'), ('banner-1', 'es', 'Hola')`
          );
          return "banner-1";
        },
      },
    ];

    describe.each(KINDS)("$name", kind => {
      /** The plans the companion step made during `save`: at least one, each with nothing to run. */
      async function plansNothingDuring(save: () => Promise<unknown>) {
        plans.length = 0;
        await save();
        expect(plans.length).toBeGreaterThan(0);
        for (const plan of plans) {
          expect(plan.statements).toEqual([]);
          expect(plan.beforeMain ?? []).toEqual([]);
        }
      }

      it("adds a translated field and a shared one, the companion step planning nothing after the file", async () => {
        await kind.create();
        await plansNothingDuring(() =>
          kind.save([
            ...TRANSLATED,
            { name: "summary", type: "text", localized: true },
            { name: "rank", type: "number", localized: false },
          ])
        );
        // The file added the translated field's companion column: a read of it finds no value.
        expect(await companionValues(kind.table, "summary")).toEqual({});
      });

      it("renames a translated field, keeping every language's value, the companion step planning nothing after the file", async () => {
        await kind.create();
        await kind.seed(t);
        await plansNothingDuring(() =>
          kind.save(
            [{ name: "title2", type: "text", localized: true }, TRANSLATED[1]!],
            [
              {
                tableName: `${kind.table}_locales`,
                fromColumn: "heading",
                toColumn: "title2",
                choice: "rename",
              },
            ]
          )
        );
        expect(await companionValues(kind.table, "title2")).toEqual({
          en: "Hello",
          es: "Hola",
        });
      });
    });
  });
}
