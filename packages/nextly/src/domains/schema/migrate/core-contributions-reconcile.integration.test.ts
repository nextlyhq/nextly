/**
 * A column and an index a schema hook contributed to a CORE table survive the
 * core reconcile `nextly migrate` runs on every invocation, on every dialect.
 *
 * The contribution is created by the app's migration stream; the reconcile
 * compares core tables against Nextly's own declaration. So the comparison
 * must set contributed elements aside — or a contributed column reads as one
 * the core declaration lost, refused as destructive on every run — and the
 * push must reach a state that includes the ones already live, or drizzle-kit
 * removes them: a drop on PostgreSQL and MySQL, and on SQLite a rebuild that
 * copies only the columns Nextly declares.
 *
 * Driven against real databases: the reconcile, the introspection, the
 * statement templates and drizzle-kit's push are all the production ones. Each
 * server dialect gets its own database, because the property is about a
 * database nothing else has touched.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createPool } from "mysql2";
import { Pool } from "pg";
import { expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { describeEachDialect } from "../../../plugins/__tests__/helpers/dialect-matrix";
import type { TestDialect } from "../../../plugins/test-nextly";
import { CORE_TABLE_NAMES, getCoreSchema } from "../../../schemas";
import { getSchemaEventsDdl } from "../events/schema-events-ddl";
import { buildExtensionSchema } from "../extension/build-extension-schema";
import { col } from "../extension/dsl";
import { coreContributions } from "../extension/entity-contributions";
import { introspectLiveSnapshot } from "../pipeline/diff/introspect-live";
import type { Operation } from "../pipeline/diff/types";
import { generateStatements } from "../pipeline/sql-templates/index";
import { sqliteTableRebuildStatements } from "../pipeline/sql-templates/sqlite-rebuild";

import { reconcileCore } from "./core-reconcile";

const DB_NAME = "nextly_core_contrib";
const CORE_INDEX = "nextly_versions_pending_edits_idx";

type Adapter = Awaited<ReturnType<typeof createAdapter>>;

/** A database of its own for one dialect, and how to take it down again. */
async function openDatabase(
  dialect: TestDialect
): Promise<{ adapter: Adapter; close: () => Promise<void> }> {
  const prevUrl = process.env.DATABASE_URL;
  const prevDialect = process.env.DB_DIALECT;
  const restoreEnv = (): void => {
    if (prevUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = prevUrl;
    if (prevDialect === undefined) delete process.env.DB_DIALECT;
    else process.env.DB_DIALECT = prevDialect;
  };

  let url: string;
  let dropDatabase: () => Promise<void>;
  if (dialect === "sqlite") {
    const dir = mkdtempSync(join(tmpdir(), "nx-core-contrib-"));
    url = `file:${join(dir, "core.db")}`;
    dropDatabase = async () => rmSync(dir, { recursive: true, force: true });
  } else if (dialect === "postgresql") {
    const admin = new Pool({ connectionString: process.env.TEST_POSTGRES_URL });
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    const target = new URL(process.env.TEST_POSTGRES_URL as string);
    target.pathname = `/${DB_NAME}`;
    url = target.toString();
    dropDatabase = async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
      await admin.end();
    };
  } else {
    const admin = createPool({
      uri: process.env.TEST_MYSQL_URL as string,
    }).promise();
    await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`);
    await admin.query(`CREATE DATABASE ${DB_NAME}`);
    const target = new URL(process.env.TEST_MYSQL_URL as string);
    target.pathname = `/${DB_NAME}`;
    url = target.toString();
    dropDatabase = async () => {
      await admin.query(`DROP DATABASE IF EXISTS ${DB_NAME}`).catch(() => {});
      await admin.end();
    };
  }

  process.env.DATABASE_URL = url;
  process.env.DB_DIALECT = dialect;
  const adapter = await createAdapter({
    type: dialect,
    url,
  } as Parameters<typeof createAdapter>[0]);
  return {
    adapter,
    close: async () => {
      await adapter.disconnect?.();
      restoreEnv();
      await dropDatabase();
    },
  };
}

/** The app's contribution to `users`: a column and an index over it. */
function contributionsFor(dialect: TestDialect) {
  return buildExtensionSchema({
    dialect,
    coreTableNames: CORE_TABLE_NAMES,
    entities: [],
    pluginPrefixes: new Map(),
    plugins: [],
    app: {
      owner: { kind: "app" },
      extend: [
        ({ schema }) => {
          schema.extendTable("users", {
            columns: { nickname: col.shortText({ nullable: true }) },
            indexes: [{ columns: ["nickname"] }],
          });
        },
      ],
    },
  });
}

/** A reconcile, a contribution applied as the app's migration applies it, and probes. */
async function setUp(dialect: TestDialect, adapter: Adapter) {
  const source = await contributionsFor(dialect);
  const ensureLedger = async (): Promise<void> => {
    if (await adapter.tableExists("nextly_schema_events")) return;
    for (const stmt of getSchemaEventsDdl(dialect)) {
      await adapter.executeQuery(stmt);
    }
  };
  const run = () =>
    reconcileCore({
      db: adapter.getDrizzle(),
      dialect,
      logger: { info: () => {}, warn: () => {} },
      ensureLedger,
      contributions: source,
    });
  const users = async () =>
    (await introspectLiveSnapshot(adapter.getDrizzle(), dialect, ["users"]))
      .tables[0];

  await run();

  // What the app's migration applies, through the same derivation and
  // statement templates: the contributed column, then its index.
  const [contribution] = [
    ...coreContributions(
      getCoreSchema(dialect).tables,
      source,
      dialect
    ).values(),
  ];
  const ops: Operation[] = [
    ...contribution.elements.columns.map(column => ({
      type: "add_column" as const,
      tableName: "users",
      column,
    })),
    ...(contribution.elements.indexes ?? []).map(index => ({
      type: "add_index" as const,
      tableName: "users",
      index,
    })),
  ];
  for (const statement of generateStatements(ops, dialect, [])) {
    await adapter.executeQuery(statement);
  }
  return { run, users };
}

describeEachDialect(
  "a contribution to a core table, across core reconciles",
  dialect => {
    it("is neither refused as drift nor removed by the push a core change makes", async () => {
      const { adapter, close } = await openDatabase(dialect);
      try {
        const { run, users } = await setUp(dialect, adapter);
        const holdsContribution = async () => {
          const live = await users();
          return {
            column: live?.columns.some(c => c.name === "nickname") ?? false,
            index:
              live?.indexes?.some(i => i.name === "idx_users_nickname") ??
              false,
          };
        };
        expect(await holdsContribution()).toEqual({
          column: true,
          index: true,
        });

        // The next migrate: nothing of Nextly's own has changed.
        expect((await run()).changed).toBe(false);

        // A genuine core change, which makes the reconcile push.
        await adapter.executeQuery(
          dialect === "mysql"
            ? `DROP INDEX ${CORE_INDEX} ON nextly_versions`
            : `DROP INDEX ${CORE_INDEX}`
        );
        expect((await run()).changed).toBe(true);
        const versions = (
          await introspectLiveSnapshot(adapter.getDrizzle(), dialect, [
            "nextly_versions",
          ])
        ).tables[0];
        expect(versions?.indexes?.map(i => i.name)).toContain(CORE_INDEX);

        // The contribution stood through both.
        expect(await holdsContribution()).toEqual({
          column: true,
          index: true,
        });
      } finally {
        await close();
      }
    }, 90_000);

    if (dialect === "sqlite") {
      it("keeps a contributed column's VALUES through a rebuild of the core table", async () => {
        const { adapter, close } = await openDatabase(dialect);
        try {
          const { run, users } = await setUp(dialect, adapter);
          await adapter.executeQuery(
            `INSERT INTO users (id, email, is_active, failed_login_attempts, created_at, updated_at, nickname) ` +
              `VALUES ('u1', 'a@example.com', 0, 0, 0, 0, 'Ace')`
          );

          // Drift SQLite can only repair by rebuilding `users`: `email` made
          // nullable, through the production rebuild helper, keeping every
          // column the table has — the contribution included.
          const live = await users();
          const drifted = {
            ...live!,
            columns: live!.columns.map(column =>
              column.name === "email" ? { ...column, nullable: true } : column
            ),
          };
          await adapter.executeQuery("PRAGMA foreign_keys = OFF");
          for (const statement of sqliteTableRebuildStatements(drifted)) {
            await adapter.executeQuery(statement);
          }

          expect((await run()).changed).toBe(true);
          const after = await users();
          expect(after?.columns.find(c => c.name === "email")?.nullable).toBe(
            false
          );
          const rows = (await adapter.executeQuery(
            `SELECT nickname FROM users WHERE id = 'u1'`
          )) as { nickname: string | null }[];
          expect(rows[0]?.nickname).toBe("Ace");
        } finally {
          await close();
        }
      }, 90_000);
    }
  }
);
