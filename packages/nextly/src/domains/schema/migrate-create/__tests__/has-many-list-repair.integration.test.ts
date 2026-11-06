/**
 * A production site's hasMany relationship whose column was created as one reference, repaired by
 * a generated migration.
 *
 * The Schema Builder used to create a hasMany relationship's column as a single reference: a
 * scalar column with a foreign key and an index, while the field said many. A site deployed with
 * migrations reaches its database only through `nextly migrate`, so the repair has to be a file
 * `migrate:create` writes. Here the old table is made by the Builder's own DDL for a single
 * relationship, which is exactly the column the hasMany field was given, and holds a bare id. The
 * database is then adopted (`migrate:baseline`, which records what the database holds), the
 * config says hasMany, and the file `migrate:create` writes is applied by `nextly migrate`. The
 * column must come out a list of the id it held, with no key to one row.
 *
 * PostgreSQL and MySQL only. On SQLite the column is text before and after, and a table built from
 * config records no foreign keys, so the two snapshots a file is written from describe the same
 * column there: the repair reaches SQLite through the next Schema Builder save or `db:sync`, which
 * read the live table.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  createScratchDatabase,
  type ScratchDatabase,
} from "../../../../__tests__/helpers/fresh-database";
import type { ResolvedDevOptions } from "../../../../cli/commands/db-sync";
import { ensureCoreTables } from "../../../../cli/commands/dev-server";
import { baselineCore } from "../../../../cli/commands/migrate-baseline";
import { runFileMigrations } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import type { CommandContext } from "../../../../cli/program";
import type { CLIDatabaseAdapter } from "../../../../cli/utils/adapter";
import {
  defineCollection,
  defineConfig,
  relationship,
  text,
} from "../../../../config";
import { createAdapter } from "../../../../database/factory";
import { getDialectTables } from "../../../../database/index";
import { SchemaRegistry } from "../../../../database/schema-registry";
import { DynamicCollectionSchemaService } from "../../../dynamic-collections/services/dynamic-collection-schema-service";
import { introspectLiveSnapshot } from "../../pipeline/diff/introspect-live";
import { resolveCollectionTableName } from "../../utils/resolve-table-name";
import { toMinimalEntities } from "../config-entities";
import { generateMigration } from "../generate";

const logger = createLogger({ quiet: true });

const A = "3fb954e4-f04c-4de6-b970-d16bf548688a";

// Each dialect's suite is declared whether or not its database is configured, and skipped when it
// is not, so a run with neither (the SQLite leg) still finds a suite in this file.
const DIALECTS = [
  ["postgresql", "TEST_POSTGRES_URL"],
  ["mysql", "TEST_MYSQL_URL"],
] as const;

/** The config as it stands: `author` is a hasMany relationship. */
const config = defineConfig({
  collections: [
    defineCollection({
      slug: "authors",
      fields: [text({ name: "title" }), text({ name: "name" })],
    }),
    defineCollection({
      slug: "posts",
      fields: [
        text({ name: "title" }),
        relationship({ name: "author", relationTo: "authors", hasMany: true }),
      ],
    }),
  ],
});

for (const [dialect, env] of DIALECTS) {
  describe.skipIf((process.env[env] ?? "") === "")(
    `a hasMany column created as one reference, repaired by a migration — ${dialect}`,
    () => {
      let scratch: ScratchDatabase;
      let adapter: DrizzleAdapter;
      let dir: string;
      let previousDialect: string | undefined;
      let previousUrl: string | undefined;

      beforeEach(async () => {
        previousDialect = process.env.DB_DIALECT;
        previousUrl = process.env.DATABASE_URL;
        dir = mkdtempSync(join(tmpdir(), "nextly-hm-repair-"));
        scratch = await createScratchDatabase(dialect, "nextly_hm_repair");
        process.env.DB_DIALECT = dialect;
        process.env.DATABASE_URL = scratch.url;
        adapter = (await createAdapter({
          type: dialect,
          url: scratch.url,
        } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      });

      afterEach(async () => {
        await adapter.disconnect().catch(() => {});
        await scratch.drop();
        rmSync(dir, { recursive: true, force: true });
        if (previousDialect === undefined) delete process.env.DB_DIALECT;
        else process.env.DB_DIALECT = previousDialect;
        if (previousUrl === undefined) delete process.env.DATABASE_URL;
        else process.env.DATABASE_URL = previousUrl;
      });

      /** The Builder's CREATE for a table, run statement by statement. */
      async function builderCreate(
        tableName: string,
        fields: Parameters<
          DynamicCollectionSchemaService["generateMigrationSQL"]
        >[1]
      ): Promise<void> {
        const sql = new DynamicCollectionSchemaService(
          undefined,
          dialect
        ).generateMigrationSQL(tableName, fields);
        for (const statement of sql.split("--> statement-breakpoint")) {
          const body = statement
            .split("\n")
            .filter(line => !line.trim().startsWith("--"))
            .join("\n")
            .trim();
          if (body !== "") await adapter.executeQuery(body);
        }
      }

      const q = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;

      it("converts the column to a list of the id it held, and drops its key to one row", async () => {
        // The core tables a site has, the migration lock among them, and the resolver its writes go
        // through.
        const registry = new SchemaRegistry(dialect);
        registry.registerStaticSchemas(getDialectTables(dialect));
        adapter.setTableResolver(registry);
        await ensureCoreTables(
          adapter as unknown as CLIDatabaseAdapter,
          { cwd: "", autoSync: true } as ResolvedDevOptions,
          { logger, options: {} } as CommandContext
        );
        const posts = resolveCollectionTableName("posts");
        const authors = resolveCollectionTableName("authors");
        await builderCreate(authors, [{ name: "name", type: "text" }]);
        // A single relationship's column: what the Builder gave a hasMany field.
        await builderCreate(posts, [
          { name: "title", type: "text" },
          {
            name: "author",
            type: "relationship",
            options: { target: "authors", relationType: "manyToOne" },
          },
        ]);
        const before = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          dialect,
          [posts]
        );
        // The old shape, so the case starts where a site's database does.
        expect(
          before.tables[0]?.foreignKeys?.flatMap(fk => fk.columns)
        ).toContain("author");
        await adapter.executeQuery(
          `INSERT INTO ${q(authors)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("name")}) VALUES ('${A}', 'a', 'A', 'A')`
        );
        await adapter.executeQuery(
          `INSERT INTO ${q(posts)} (${q("id")}, ${q("slug")}, ${q("title")}, ${q("author")}) VALUES ('p1', 'p1', 'P1', '${A}'), ('p2', 'p2', 'P2', NULL)`
        );

        const migrationsDir = join(dir, "migrations");
        const deps = {
          adapter: adapter as unknown as CLIDatabaseAdapter,
          db: adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger,
        };
        const adopted = await baselineCore(deps);
        expect(adopted.kind).toBe("baselined");

        const generated = await generateMigration({
          name: "author_holds_many",
          dialect,
          migrationsDir,
          collections: toMinimalEntities(config.collections, e =>
            resolveCollectionTableName(e.slug, e.dbName)
          ),
          singles: [],
          components: [],
          nonInteractive: true,
        });
        expect(generated).not.toBeNull();

        await runFileMigrations(deps);

        const rows = await adapter.executeQuery<{
          id: string;
          author: unknown;
        }>(
          `SELECT ${q("id")}, ${q("author")} FROM ${q(posts)} ORDER BY ${q("id")}`
        );
        const read = (value: unknown) =>
          typeof value === "string" ? (JSON.parse(value) as unknown) : value;
        expect(rows.map(row => [row.id, read(row.author)])).toEqual([
          ["p1", [A]],
          ["p2", null],
        ]);
        const after = await introspectLiveSnapshot(
          adapter.getDrizzle(),
          dialect,
          [posts]
        );
        expect(
          (after.tables[0]?.foreignKeys ?? []).flatMap(fk => fk.columns)
        ).not.toContain("author");
      });
    }
  );
}
