/**
 * Turning translation on for an existing collection, Single or field group through its schema
 * dialog keeps every value, as the default language's, on every dialect.
 *
 * The enable moves each translated field's value from the main table to the default language's
 * companion row, then drops the main column, once. The schema apply also moves a field's value
 * when the field alone becomes translated in an entity that already is; an enable is not that, and
 * moving the values there as well left the enable's own move adding columns the companion already
 * had, with the main columns gone.
 */
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { dispatchCollections } from "../../../dispatcher/handlers/collection-dispatcher";
import { dispatchComponents } from "../../../dispatcher/handlers/component-dispatcher";
import { dispatchSingles } from "../../../dispatcher/handlers/single-dispatcher";
import { buildFullDesiredSchema } from "../../../dispatcher/helpers/desired-schema";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import type { ServiceContainer } from "../../../services";
import { RealClassifier } from "../../schema/pipeline/classifier/classifier";
import { RealPreCleanupExecutor } from "../../schema/pipeline/pre-cleanup/executor";
import { PushSchemaPipeline } from "../../schema/pipeline/pushschema-pipeline";
import {
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
} from "../../schema/pipeline/pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../../schema/pipeline/rename-detector";
import { DrizzleStatementExecutor } from "../../schema/services/drizzle-statement-executor";
import type { SingleEntryService } from "../../singles/services/single-entry-service";

const FIELDS = [
  { name: "heading", type: "text" },
  { name: "views", type: "number" },
];

interface CollectionsHandler {
  createCollection(data: Record<string, unknown>): Promise<{
    success: boolean;
  }>;
  getEntryService(): {
    createEntry(
      params: { collectionName: string; overrideAccess?: boolean },
      data: Record<string, unknown>
    ): Promise<{ success: boolean; data: unknown }>;
  };
}

function quote(dialect: TestDialect, name: string): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

describeEachDialect(
  "translation turned on through a schema dialog",
  dialect => {
    let current: TestNextly;

    beforeEach(async () => {
      // The dialogs apply their migration in development only.
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

    const q = (name: string) => quote(dialect, name);

    async function query<T>(sql: string): Promise<T[]> {
      return (
        current.adapter as unknown as {
          executeQuery<R>(statement: string): Promise<R[]>;
        }
      ).executeQuery<T>(sql);
    }

    async function columnsOf(table: string): Promise<string[]> {
      const rows = await query<{ name: string }>(
        dialect === "mysql"
          ? `SELECT COLUMN_NAME AS name FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${table}'`
          : dialect === "sqlite"
            ? `SELECT name FROM pragma_table_info('${table}')`
            : `SELECT column_name AS name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = '${table}'`
      );
      return rows.map(row => row.name);
    }

    async function schemaVersionOf(
      registry: string,
      slug: string
    ): Promise<number> {
      const [row] = await query<{ version: number | string | null }>(
        `SELECT ${q("schema_version")} AS version FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return Number(row?.version ?? 1);
    }

    async function localizedIn(
      registry: string,
      slug: string
    ): Promise<boolean> {
      const [row] = await query<{ localized: unknown }>(
        `SELECT ${q("localized")} AS localized FROM ${q(registry)} WHERE ${q("slug")} = '${slug}'`
      );
      return row?.localized === true || Number(row?.localized) === 1;
    }

    const PATHS = [
      {
        path: "a collection's schema dialog",
        table: "dc_posts",
        registry: "dynamic_collections",
        slug: "posts",
        seed: async () => {
          const handler = current.getService(
            "collectionsHandler"
          ) as unknown as CollectionsHandler;
          const created = await handler.createCollection({
            name: "posts",
            label: "Post",
            fields: FIELDS,
          });
          expect(created.success, JSON.stringify(created)).toBe(true);
          const entry = await handler
            .getEntryService()
            .createEntry(
              { collectionName: "posts", overrideAccess: true },
              { heading: "Hello", views: 7 }
            );
          expect(entry.success, JSON.stringify(entry)).toBe(true);
          // An entry with no value for the field, which still gets its default-language row.
          const empty = await handler
            .getEntryService()
            .createEntry(
              { collectionName: "posts", overrideAccess: true },
              { views: 1 }
            );
          expect(empty.success, JSON.stringify(empty)).toBe(true);
          return String((entry.data as { id: unknown }).id);
        },
        enable: async () => {
          await dispatchCollections(
            {} as ServiceContainer,
            "applySchemaChanges",
            { collectionName: "posts" },
            {
              fields: FIELDS,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_collections",
                "posts"
              ),
            }
          );
        },
      },
      {
        path: "a Single's schema dialog",
        table: "single_hero",
        registry: "dynamic_singles",
        slug: "hero",
        seed: async () => {
          await dispatchSingles(
            "createSingle",
            {},
            { slug: "hero", label: "Hero", fields: FIELDS }
          );
          const singles: SingleEntryService =
            current.getService("singleEntryService");
          const written = await singles.update(
            "hero",
            { heading: "Hello", views: 7 },
            { overrideAccess: true }
          );
          expect(written.success, JSON.stringify(written)).toBe(true);
          const [row] = await query<{ id: string }>(
            `SELECT ${q("id")} AS id FROM ${q("single_hero")}`
          );
          return String(row.id);
        },
        enable: async () => {
          await dispatchSingles(
            "applySingleSchemaChanges",
            { slug: "hero" },
            {
              fields: FIELDS,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf("dynamic_singles", "hero"),
            }
          );
        },
      },
      {
        path: "a field group's schema dialog",
        table: "comp_banner",
        registry: "dynamic_components",
        slug: "banner",
        seed: async () => {
          await dispatchComponents(
            "createComponent",
            {},
            { slug: "banner", label: "Banner", fields: FIELDS }
          );
          // A field group's rows belong to the entries embedding it, so the row is written as an
          // embedding entry would write it.
          await query(
            `INSERT INTO ${q("comp_banner")} (${["id", "_parent_id", "_parent_table", "_parent_field", "heading", "views"].map(q).join(", ")}) ` +
              `VALUES ('banner-1', 'entry-1', 'dc_pages', 'banner', 'Hello', 7), ` +
              `('banner-2', 'entry-2', 'dc_pages', 'banner', NULL, 1)`
          );
          return "banner-1";
        },
        enable: async () => {
          await dispatchComponents(
            "applyComponentSchemaChanges",
            { slug: "banner" },
            {
              fields: FIELDS,
              confirmed: true,
              localized: true,
              schemaVersion: await schemaVersionOf(
                "dynamic_components",
                "banner"
              ),
            }
          );
        },
      },
    ];

    it.each(PATHS)(
      "keeps the value as English's when $path turns it on",
      async ({ table, registry, slug, seed, enable }) => {
        const id = await seed();

        await enable();

        const [en] = await query<{ heading: string | null }>(
          `SELECT ${q("heading")} AS heading FROM ${q(`${table}_locales`)} ` +
            `WHERE ${q("_parent")} = '${id}' AND ${q("_locale")} = 'en'`
        );
        expect(en?.heading).toBe("Hello");
        // Every entry has its default-language row, one with no value included.
        const [counts] = await query<{
          main: number | string;
          en: number | string;
        }>(
          `SELECT (SELECT COUNT(*) FROM ${q(table)}) AS main, ` +
            `(SELECT COUNT(*) FROM ${q(`${table}_locales`)} WHERE ${q("_locale")} = 'en') AS en`
        );
        expect(Number(counts?.en)).toBe(Number(counts?.main));
        expect(await columnsOf(table)).not.toContain("heading");
        expect(await localizedIn(registry, slug)).toBe(true);
      }
    );

    it("finishes, on the next save, an enable a dialog left half-applied", async () => {
      // The state a dialog enable left before this was fixed: the schema apply moved the values to
      // the companion and dropped the main column, and the companion step then failed, so the
      // registry still says the collection is not translated. A schema apply that turns
      // translation on with nothing after it leaves exactly that.
      const [collection] = PATHS;
      const id = await collection.seed();
      const desired = await buildFullDesiredSchema();
      const posts = desired.collections.posts;
      if (!posts) throw new Error("the collection posts is missing");
      desired.collections.posts = {
        ...posts,
        fields: FIELDS as typeof posts.fields,
        localized: true,
      };
      const db = current.adapter.getDrizzle();
      const databaseName =
        dialect === "mysql"
          ? String(
              (
                await query<Record<string, unknown>>(
                  "SELECT DATABASE() AS name"
                )
              )[0]?.name
            )
          : undefined;
      const halfway = await new PushSchemaPipeline({
        executor: new DrizzleStatementExecutor(dialect, db),
        renameDetector: new RegexRenameDetector(),
        classifier: new RealClassifier(),
        promptDispatcher: {
          dispatch: ({ events }) =>
            Promise.resolve({
              confirmedRenames: [],
              resolutions: events.map(event => ({
                kind: "confirm_drop" as const,
                eventId: event.id,
              })),
              proceed: true,
            }),
        },
        preRenameExecutor: noopPreRenameExecutor,
        preCleanupExecutor: new RealPreCleanupExecutor(),
        migrationJournal: noopMigrationJournal,
        notifier: noopNotifier,
      }).apply({
        desired,
        db,
        dialect,
        source: "code",
        promptChannel: "terminal",
        defaultLocale: "en",
        ...(databaseName !== undefined ? { databaseName } : {}),
      });
      expect(halfway.success, JSON.stringify(halfway)).toBe(true);
      expect(await localizedIn("dynamic_collections", "posts")).toBe(false);
      expect(await columnsOf("dc_posts")).not.toContain("heading");

      await collection.enable();

      const [en] = await query<{ heading: string | null }>(
        `SELECT ${q("heading")} AS heading FROM ${q("dc_posts_locales")} ` +
          `WHERE ${q("_parent")} = '${id}' AND ${q("_locale")} = 'en'`
      );
      expect(en?.heading).toBe("Hello");
      expect(await localizedIn("dynamic_collections", "posts")).toBe(true);
    });
  }
);
