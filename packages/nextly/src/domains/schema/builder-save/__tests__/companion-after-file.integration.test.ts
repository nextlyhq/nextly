/**
 * A translated Single's, field group's or collection's Builder save that moves no values runs its own migration
 * file, which changes the companion `<table>_locales` too; the companion step that runs after it
 * then finds the companion already in step and plans nothing, so no statement runs twice. A
 * translated field renamed or removed keeps the push (`pushCarriesValues`), its companion judged
 * against the companion as it stands.
 *
 * Every plan the companion step makes is recorded (`buildCompanionTransitionStatements`): a save
 * the push applied instead would plan the companion's change itself, as the push leaves the
 * companion alone.
 */
import { readFileSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../../dispatcher/handlers/single-dispatcher";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../../services";
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
      {
        name: "a collection",
        table: "dc_posts",
        registry: "dynamic_collections",
        slug: "posts",
        create: () =>
          dispatchCollections(
            {} as ServiceContainer,
            "createCollection",
            {},
            {
              name: "posts",
              label: "Post",
              localized: true,
              fields: TRANSLATED,
            }
          ),
        save: async (fields, renameResolutions = []) =>
          dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields,
              confirmed: true,
              localized: true,
              renameResolutions,
              schemaVersion: await schemaVersionOf(
                "dynamic_collections",
                "posts"
              ),
            }
          ),
        // One entry, written in each language as the collection's own writes store it.
        seed: async () => {
          const created = (await t.nextly.create({
            collection: "posts",
            locale: "en",
            data: { title: "Post", heading: "Hello", views: 7 },
          } as never)) as { item: { id: string } };
          await t.nextly.update({
            collection: "posts",
            id: created.item.id,
            locale: "es",
            data: { heading: "Hola", _overwrite: true },
          } as never);
          return created.item.id;
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

      // SQLite rebuilds a table to make a column required. The companion's rows reference the
      // main table ON DELETE CASCADE, so a rebuild run with foreign keys on would drop every
      // language's value with the old table; the file runs as `nextly migrate` runs one, with
      // them off and the dangling-reference check after.
      it.runIf(dialect === "sqlite")(
        "makes a shared field required through a rebuild, keeping every language's value, with foreign keys back on after",
        async () => {
          await kind.create();
          await kind.seed(t);
          const filesBefore = new Set(
            readdirSync(join(basePath, "migrations"))
          );

          await kind.save([
            TRANSLATED[0]!,
            { name: "views", type: "number", localized: false, required: true },
          ]);

          const written = readdirSync(join(basePath, "migrations")).filter(
            name => name.endsWith(".sql") && !filesBefore.has(name)
          );
          const up = written
            .map(
              name =>
                readFileSync(join(basePath, "migrations", name), "utf-8").split(
                  "-- DOWN"
                )[0]
            )
            .join("\n");
          // The change reached the rebuild: the main table made again and the old one dropped.
          expect(up).toMatch(new RegExp(`DROP TABLE [^;]*${kind.table}`, "i"));
          expect(await companionValues(kind.table, "heading")).toEqual({
            en: "Hello",
            es: "Hola",
          });
          const [enforced] = await exec<{ foreign_keys: number }>(
            "PRAGMA foreign_keys"
          );
          expect(Number(enforced?.foreign_keys)).toBe(1);
        }
      );

      it("renames a shared field, keeping its value and every language's, the companion step planning nothing after the file", async () => {
        await kind.create();
        await kind.seed(t);
        await plansNothingDuring(() =>
          kind.save(
            [
              TRANSLATED[0]!,
              { name: "hits", type: "number", localized: false },
            ],
            [
              {
                tableName: kind.table,
                fromColumn: "views",
                toColumn: "hits",
                choice: "rename",
              },
            ]
          )
        );
        const kept = await exec<{ hits: unknown }>(
          `SELECT ${q("hits")} AS hits FROM ${q(kind.table)}`
        );
        expect(kept.map(row => Number(row.hits))).toEqual([7]);
        expect(await companionValues(kind.table, "heading")).toEqual({
          en: "Hello",
          es: "Hola",
        });
      });
    });
  });
}
