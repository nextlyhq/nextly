/**
 * A fresh install creates a plugin table's foreign keys to code-first tables,
 * on every dialect.
 *
 * A code-first collection's, Single's or field group's table is created later
 * in the boot than a plugin's own tables. PostgreSQL and MySQL add a foreign
 * key with a statement of its own, which fails while its target is missing, so
 * these keys exist only if the apply that creates the code-first tables adds
 * them afterwards. SQLite declares a key inside CREATE TABLE and resolves its
 * target only when a row is written, so it reaches the same end by another
 * route — which is why every dialect is asked.
 *
 * Asked of each database's own catalog, not of the compiled schema, and
 * proved by a write the key must refuse: a table without the key accepts every
 * row here, so only enforcement separates the two.
 */
import { randomBytes } from "node:crypto";

import { afterEach, describe, expect, it } from "vitest";

import {
  defineCollection,
  defineFieldGroup,
  defineSingle,
  text,
} from "../../../config";
import { createAdapter } from "../../../database/factory";
import {
  createDatabaseStatement,
  dropDatabaseStatement,
} from "../../../database/test-database-ddl";
import { clearServices } from "../../../di/register";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import { definePlugin } from "../../../plugins/plugin-context";
import {
  createTestNextly,
  type TestDialect,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { _resetEnvCache } from "../../../shared/lib/env";

import { col, defineTable } from "./dsl";

const posts = defineCollection({
  slug: "cf-posts",
  fields: [text({ name: "title" })],
});
const site = defineSingle({
  slug: "cf-site",
  fields: [text({ name: "name" })],
});
const part = defineFieldGroup({
  slug: "cf-part",
  fields: [text({ name: "label" })],
});

// Each key column is nullable, so one row can test one key while the others
// stay empty.
const refs = defineTable(
  "refs",
  {
    id: col.id(),
    postId: col.shortText({ nullable: true }),
    siteId: col.shortText({ nullable: true }),
    partId: col.shortText({ nullable: true }),
  },
  {
    foreignKeys: [
      {
        columns: ["postId"],
        references: { table: "dc_cf_posts", columns: ["id"] },
      },
      {
        columns: ["siteId"],
        references: { table: "single_cf_site", columns: ["id"] },
      },
      {
        columns: ["partId"],
        references: { table: "comp_cf_part", columns: ["id"] },
      },
    ],
  }
);

const fixture = definePlugin({
  name: "fresh-install-fk-fixture",
  version: "0.0.0",
  nextly: "*",
  contributes: {
    collections: [posts],
    singles: [site],
    fieldGroups: [part],
    schema: { prefix: "cf", tables: [refs] },
  },
});

/** `column->table.column` for each foreign key on `table`, read from the catalog. */
async function foreignKeysOf(
  adapter: TestNextly["adapter"],
  dialect: TestDialect,
  table: string
): Promise<string[]> {
  let rows: Array<Record<string, unknown>>;
  if (dialect === "sqlite") {
    rows = await adapter.executeQuery(
      `SELECT "from" AS src, "table" AS tgt, "to" AS dst FROM pragma_foreign_key_list('${table}')`
    );
  } else if (dialect === "postgresql") {
    rows = await adapter.executeQuery(
      `SELECT kcu.column_name AS src, ccu.table_name AS tgt, ccu.column_name AS dst
         FROM information_schema.table_constraints tc
         JOIN information_schema.key_column_usage kcu
           ON kcu.constraint_name = tc.constraint_name
          AND kcu.table_schema = tc.table_schema
         JOIN information_schema.constraint_column_usage ccu
           ON ccu.constraint_name = tc.constraint_name
          AND ccu.table_schema = tc.table_schema
        WHERE tc.constraint_type = 'FOREIGN KEY'
          AND tc.table_schema = current_schema()
          AND tc.table_name = '${table}'`
    );
  } else {
    rows = await adapter.executeQuery(
      `SELECT COLUMN_NAME AS src, REFERENCED_TABLE_NAME AS tgt, REFERENCED_COLUMN_NAME AS dst
         FROM information_schema.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = '${table}'
          AND REFERENCED_TABLE_NAME IS NOT NULL`
    );
  }
  return rows
    .map(row => `${String(row.src)}->${String(row.tgt)}.${String(row.dst)}`)
    .sort();
}

let current: TestNextly | undefined;

afterEach(async () => {
  await current?.destroy();
  current = undefined;
});

describeEachDialect(
  "a fresh install's foreign keys to code-first tables",
  dialect => {
    it("exist in the database and refuse a dangling row", async () => {
      current = await createTestNextly({ dialect, plugins: [fixture] });
      const adapter = current.adapter;

      expect(await foreignKeysOf(adapter, dialect, "cf__refs")).toEqual([
        "part_id->comp_cf_part.id",
        "post_id->dc_cf_posts.id",
        "site_id->single_cf_site.id",
      ]);

      // The controls: a row whose keys are empty, and one whose key names a
      // real entry, are both accepted, so the refusals below are the keys
      // and not a broken insert.
      const post = await current.nextly.create({
        collection: "cf-posts",
        data: { title: "First" },
      });
      await adapter.executeQuery(
        `INSERT INTO cf__refs (id) VALUES ('018f2c2e-0000-7000-8000-00000000f001')`
      );
      await adapter.executeQuery(
        `INSERT INTO cf__refs (id, post_id) VALUES ('018f2c2e-0000-7000-8000-00000000f002', '${String(post.item.id)}')`
      );

      const missing = "018f2c2e-0000-7000-8000-00000000dead";
      for (const [at, column] of ["post_id", "site_id", "part_id"].entries()) {
        await expect(
          adapter.executeQuery(
            `INSERT INTO cf__refs (id, ${column}) VALUES ('018f2c2e-0000-7000-8000-00000000f10${String(at)}', '${missing}')`
          )
        ).rejects.toThrow();
      }
    });
  }
);

/** The name of the foreign key on `table`'s `column`, read from the catalog. */
async function foreignKeyNameOn(
  adapter: TestNextly["adapter"],
  dialect: "postgresql" | "mysql",
  table: string,
  column: string
): Promise<string> {
  const rows = await adapter.executeQuery<{ name: string }>(
    dialect === "postgresql"
      ? `SELECT tc.constraint_name AS name
           FROM information_schema.table_constraints tc
           JOIN information_schema.key_column_usage kcu
             ON kcu.constraint_name = tc.constraint_name
            AND kcu.table_schema = tc.table_schema
          WHERE tc.constraint_type = 'FOREIGN KEY'
            AND tc.table_schema = current_schema()
            AND tc.table_name = '${table}'
            AND kcu.column_name = '${column}'`
      : `SELECT CONSTRAINT_NAME AS name
           FROM information_schema.KEY_COLUMN_USAGE
          WHERE TABLE_SCHEMA = DATABASE()
            AND TABLE_NAME = '${table}'
            AND COLUMN_NAME = '${column}'
            AND REFERENCED_TABLE_NAME IS NOT NULL`
  );
  const name = rows[0]?.name;
  expect(name, `foreign key on ${table}.${column}`).toBeDefined();
  return String(name);
}

// PostgreSQL and MySQL only: they hold a foreign key apart from its table, so a
// key can go missing while its table stays — as when an apply commits the
// code-first tables and fails on the key, which MySQL's DDL can. SQLite keeps
// the key inside its CREATE TABLE, so it has no such state to restart into.
//
// The boot is the code under test, so the database is created here and booted
// three times: once fresh, once after the key is dropped, and once after the
// table gains a row. The harness's own provisioning drops its database when
// the next instance boots, which is why this one is not used.
for (const dialect of ["postgresql", "mysql"] as const) {
  const serverUrl =
    process.env[
      dialect === "postgresql" ? "TEST_POSTGRES_URL" : "TEST_MYSQL_URL"
    ];
  (serverUrl ? describe : describe.skip)(
    `a restart that finds a key to a code-first table missing (${dialect})`,
    () => {
      it("is refused while the table holds no rows, and boots once it holds one", async () => {
        const server = await createAdapter({
          type: dialect,
          url: serverUrl as string,
        });
        const name = `nextly_t_${randomBytes(12).toString("hex")}`;
        const databaseUrl = new URL(serverUrl as string);
        databaseUrl.pathname = `/${name}`;
        const previousUrl = process.env.DATABASE_URL;
        const previousDialect = process.env.DB_DIALECT;
        await server.executeQuery(createDatabaseStatement(dialect, name));
        let handle: TestNextly | undefined;
        try {
          process.env.DATABASE_URL = databaseUrl.toString();
          process.env.DB_DIALECT = dialect;
          _resetEnvCache();
          const adapter = await createAdapter({
            type: dialect,
            url: databaseUrl.toString(),
          });

          handle = await createTestNextly({ adapter, plugins: [fixture] });
          const key = await foreignKeyNameOn(
            adapter,
            dialect,
            "cf__refs",
            "post_id"
          );
          await adapter.executeQuery(
            dialect === "postgresql"
              ? `ALTER TABLE cf__refs DROP CONSTRAINT ${key}`
              : `ALTER TABLE cf__refs DROP FOREIGN KEY ${key}`
          );

          // The tables are all there, so this boot creates nothing; only
          // asking again finds the key gone.
          clearServices();
          // A boot that wrongly succeeds is kept, so `finally` releases its
          // connection before the database is dropped.
          const restart = await createTestNextly({
            adapter,
            plugins: [fixture],
          }).then(
            booted => {
              handle = booted;
              return undefined;
            },
            (error: unknown) => error
          );
          expect(restart).toMatchObject({
            code: "VALIDATION_ERROR",
            logContext: {
              missingForeignKeys: [
                expect.stringContaining(`"${key}" on "cf__refs"`),
              ],
            },
          });

          // A row makes it drift on a table in use, which the boot leaves to
          // `nextly db:sync` and migrations rather than refusing. A refused
          // boot releases the adapter it was handed, so this one connects
          // anew.
          const reopened = await createAdapter({
            type: dialect,
            url: databaseUrl.toString(),
          });
          await reopened.executeQuery(
            `INSERT INTO cf__refs (id) VALUES ('018f2c2e-0000-7000-8000-00000000f201')`
          );
          clearServices();
          handle = await createTestNextly({
            adapter: reopened,
            plugins: [fixture],
          });
        } finally {
          await handle?.destroy();
          await server.executeQuery(dropDatabaseStatement(dialect, name));
          await server.disconnect();
          if (previousUrl === undefined) delete process.env.DATABASE_URL;
          else process.env.DATABASE_URL = previousUrl;
          if (previousDialect === undefined) delete process.env.DB_DIALECT;
          else process.env.DB_DIALECT = previousDialect;
          _resetEnvCache();
        }
      });
    }
  );
}
