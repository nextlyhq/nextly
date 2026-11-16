/**
 * A relation's storage shape changed in configuration, carried to the database by the migration
 * files `migrate:create` writes and `nextly migrate` applies.
 *
 * A relation stores one id, a list of ids, or `{ relationTo, value }` references to several
 * collections. The column's type does not always say which: on SQLite every one of them is text.
 * So each migration snapshot records the shape of every relation column, and the next file is
 * written from the shape it had to the shape it has: one to many converts each id into a one-item
 * list, many to one converts back, and a switch to or from several collections, which no
 * conversion can make, is refused by the file before it changes anything while a row holds a
 * value.
 *
 * Every dialect runs every case, a collection's relation and a field group's alike.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import type { SupportedDialect } from "@nextlyhq/adapter-drizzle/types";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import type { ResolvedDevOptions } from "../../../../cli/commands/db-sync";
import { ensureCoreTables } from "../../../../cli/commands/dev-server";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import type { CommandContext } from "../../../../cli/program";
import type { CLIDatabaseAdapter } from "../../../../cli/utils/adapter";
import { createLogger } from "../../../../cli/utils/logger";
import {
  defineCollection,
  defineConfig,
  relationship,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { getDialectTables } from "../../../../database/index";
import { SchemaRegistry } from "../../../../database/schema-registry";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

const logger = createLogger({ quiet: true });

const A = "3fb954e4-f04c-4de6-b970-d16bf548688a";

const DIALECTS: SupportedDialect[] = [
  "sqlite",
  ...((process.env.TEST_POSTGRES_URL ?? "") !== ""
    ? (["postgresql"] as const)
    : []),
  ...((process.env.TEST_MYSQL_URL ?? "") !== "" ? (["mysql"] as const) : []),
];

const authors = defineCollection({
  slug: "authors",
  fields: [text({ name: "name" })],
});
const tags = defineCollection({
  slug: "tags",
  fields: [text({ name: "label" })],
});
/** `posts`, whose `author` names the targets given, one entry or many. */
const posts = (relationTo: string | string[], hasMany = false) =>
  defineCollection({
    slug: "posts",
    fields: [
      text({ name: "headline" }),
      relationship({ name: "author", relationTo, hasMany } as never),
    ],
  });
/** `posts` translated per language, whose translated `author` holds one entry or many. */
const translatedPosts = (hasMany: boolean, translated = true) =>
  defineCollection({
    slug: "posts",
    localized: true,
    fields: [
      text({ name: "headline" }),
      relationship({
        name: "author",
        relationTo: "authors",
        hasMany,
        localized: translated,
      } as never),
    ],
  });

/** A field group `hero` whose `tag` relation holds one entry or many. */
const hero = (hasMany: boolean) => ({
  slug: "hero",
  tableName: "comp_hero",
  fields: [{ name: "tag", type: "relationship", relationTo: "tags", hasMany }],
});

for (const dialect of DIALECTS) {
  describe(`a relation's shape changed by a generated migration — ${dialect}`, () => {
    let scratch: ScratchDatabase | undefined;
    let adapter: DrizzleAdapter;
    let dir: string;
    let migrationsDir: string;
    let files = 0;
    let previousDialect: string | undefined;
    let previousUrl: string | undefined;

    const q = (name: string) =>
      dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

    beforeEach(async () => {
      previousDialect = process.env.DB_DIALECT;
      previousUrl = process.env.DATABASE_URL;
      dir = mkdtempSync(join(tmpdir(), "nextly-relation-shape-"));
      migrationsDir = join(dir, "migrations");
      files = 0;
      process.env.DB_DIALECT = dialect;
      if (dialect === "sqlite") {
        process.env.DATABASE_URL = `file:${join(dir, "test.db")}`;
      } else {
        scratch = await createScratchDatabase(dialect, "nextly_rel_shape");
        process.env.DATABASE_URL = scratch.url;
      }
      adapter = (await createAdapter({
        type: dialect,
        url: process.env.DATABASE_URL,
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      const registry = new SchemaRegistry(dialect);
      registry.registerStaticSchemas(getDialectTables(dialect));
      adapter.setTableResolver(registry);
      await ensureCoreTables(
        adapter as unknown as CLIDatabaseAdapter,
        { cwd: "", autoSync: true } as ResolvedDevOptions,
        { logger, options: {} } as CommandContext
      );
    });

    afterEach(async () => {
      await adapter.disconnect().catch(() => {});
      await scratch?.drop();
      scratch = undefined;
      rmSync(dir, { recursive: true, force: true });
      if (previousDialect === undefined) delete process.env.DB_DIALECT;
      else process.env.DB_DIALECT = previousDialect;
      if (previousUrl === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousUrl;
    });

    /** `migrate:create` for the configuration given, then `nextly migrate`. */
    async function migrateTo(
      collections: ReturnType<typeof defineCollection>[],
      components: ReturnType<typeof hero>[] = []
    ): Promise<void> {
      files += 1;
      await generateMigration({
        name: `step_${String(files)}`,
        dialect,
        migrationsDir,
        collections: toMinimalEntities(
          defineConfig({
            localization: { locales: ["en", "es"], defaultLocale: "en" },
            collections,
          }).collections,
          e => resolveCollectionTableName(e.slug, e.dbName)
        ),
        singles: [],
        components,
        defaultLocale: "en",
        nonInteractive: true,
      });
      await runFileMigrations({
        adapter: adapter as unknown as CLIDatabaseAdapter,
        db: adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger,
      });
    }

    /** What a column holds in its one row, read as JSON where it is JSON text. */
    async function valueOf(table: string, column: string): Promise<unknown> {
      const [row] = await adapter.executeQuery<Record<string, unknown>>(
        `SELECT ${q(column)} AS ${q("v")} FROM ${q(table)}`
      );
      const value = row?.v;
      if (typeof value !== "string") return value;
      try {
        return JSON.parse(value) as unknown;
      } catch {
        return value;
      }
    }

    async function postHolding(author: string): Promise<void> {
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("headline")}, ${q("author")}) VALUES ('p1', 'p1', 'P1', 'P1', '${author}')`
      );
    }

    it("converts each id into a one-item list when a relation becomes many", async () => {
      await migrateTo([authors, posts("authors")]);
      await postHolding(A);

      await migrateTo([authors, posts("authors", true)]);

      expect(await valueOf("dc_posts", "author")).toEqual([A]);
    });

    it("refuses a switch to several collections while a row holds a value, changing nothing", async () => {
      await migrateTo([authors, tags, posts("authors")]);
      await postHolding(A);

      await expect(
        migrateTo([authors, tags, posts(["authors", "tags"])])
        // The column named: by the guard's message, or on MySQL by its guarding constraint's name.
      ).rejects.toThrow(/dc_posts[._]author/);

      expect(await valueOf("dc_posts", "author")).toBe(A);
    });

    it("converts a translated relation's value on the translations table when it becomes many", async () => {
      await migrateTo([authors, translatedPosts(false)]);
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_posts")} (${q("id")}, ${q("slug")}, ${q("title")}) VALUES ('p1', 'p1', 'P1')`
      );
      await adapter.executeQuery(
        `INSERT INTO ${q("dc_posts_locales")} (${q("_parent")}, ${q("_locale")}, ${q("author")}) VALUES ('p1', 'es', '${A}')`
      );

      await migrateTo([authors, translatedPosts(true)]);

      expect(await valueOf("dc_posts_locales", "author")).toEqual([A]);
    });

    it("refuses a switch made in the same change that makes the relation translated", async () => {
      await migrateTo([authors, translatedPosts(false, false)]);

      // Refused before any file is written: on SQLite by this rule, where the columns are text on
      // both sides; on PostgreSQL and MySQL the move's own check already refuses a field whose
      // column changes type as it moves. Either way the field is named.
      const refused = await migrateTo([
        authors,
        translatedPosts(true, true),
      ]).then(
        () => undefined,
        (error: unknown) => error
      );
      const { message, publicData } = (refused ?? {}) as {
        message?: string;
        publicData?: unknown;
      };
      expect(`${String(message)} ${JSON.stringify(publicData)}`).toMatch(
        /'author'|"author"/
      );
    });

    it("converts a field group's list back to its one id when its relation becomes one", async () => {
      await migrateTo([tags], [hero(true)]);
      // The timestamps in the form each dialect's column holds them: SQLite keeps epoch seconds.
      const now = dialect === "sqlite" ? "0" : "CURRENT_TIMESTAMP";
      await adapter.executeQuery(
        `INSERT INTO ${q("comp_hero")} (${q("id")}, ${q("_parent_id")}, ${q("_parent_table")}, ${q("_parent_field")}, ${q("_order")}, ${q("_component_type")}, ${q("created_at")}, ${q("updated_at")}, ${q("tag")}) VALUES ('h1', 'x', 'dc_pages', 'hero', 0, 'hero', ${now}, ${now}, '${JSON.stringify([A])}')`
      );

      await migrateTo([tags], [hero(false)]);

      expect(await valueOf("comp_hero", "tag")).toBe(A);
    });
  });
}
