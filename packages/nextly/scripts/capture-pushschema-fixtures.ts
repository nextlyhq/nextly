#!/usr/bin/env node
//
// F4 PR 3 — Regression fixture capture script.
//
// For each (scenario, dialect) pair, runs the BEFORE schema against a real
// database, calls drizzle-kit's pushSchema with the AFTER schema in memory,
// captures {statementsToExecute, warnings, hasDataLoss} + the introspected
// before-column types, writes JSON to:
//
//   src/database/__tests__/integration/__fixtures__/pushSchema/
//     <scenario>-<dialect>-drizzle-kit-<version>.json
//
// Usage:
//   TEST_POSTGRES_URL=...  pnpm capture:pushschema-fixtures postgresql
//   TEST_MYSQL_URL=...     pnpm capture:pushschema-fixtures mysql
//   TEST_SQLITE_URL=...    pnpm capture:pushschema-fixtures sqlite
//   (or all three, omit dialect to capture everything)
//
// Fixture file format:
//   {
//     "scenario": "rename-field",
//     "dialect": "postgresql",
//     "drizzleKitVersion": "0.31.10",
//     "beforeColumnTypes": { "<table>": { "<col>": "<type>" } },
//     "pushSchemaResult": { statementsToExecute, warnings, hasDataLoss }
//   }
//
// The fixture-driven test (rename-detector-fixtures.integration.test.ts)
// loads each file, runs RegexRenameDetector.detect() with the embedded
// before-column types, and asserts via Vitest snapshot. A drizzle-kit
// version bump that changes output format causes the snapshot to drift.

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  integer as pgInteger,
  pgTable,
  text as pgText,
} from "drizzle-orm/pg-core";
import {
  int as mysqlInt,
  mysqlTable,
  text as mysqlText,
  varchar as mysqlVarchar,
} from "drizzle-orm/mysql-core";
import {
  integer as sqliteInteger,
  sqliteTable,
  text as sqliteText,
} from "drizzle-orm/sqlite-core";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
  getSQLiteDrizzleKit,
} from "../src/database/drizzle-kit-lazy.js";
import { queryLiveColumnTypes } from "../src/domains/schema/pipeline/live-column-types.js";

import type { SupportedDialect } from "@revnixhq/adapter-drizzle/types";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const FIXTURES_DIR = resolve(
  __dirname,
  "..",
  "src",
  "database",
  "__tests__",
  "integration",
  "__fixtures__",
  "pushSchema"
);

// Read drizzle-kit version from package.json (the pinned exact version).
function readDrizzleKitVersion(): string {
  const pkg = JSON.parse(
    readFileSync(resolve(__dirname, "..", "package.json"), "utf-8")
  ) as { dependencies?: Record<string, string> };
  const version = pkg.dependencies?.["drizzle-kit"];
  if (!version) {
    throw new Error("drizzle-kit not found in dependencies");
  }
  // Strip range prefix (^/~/=) just in case; F1 enforces exact pin via CI.
  return version.replace(/^[~^=]/, "");
}

// Each scenario describes a BEFORE state and an AFTER schema. For
// rename/multi-rename, the AFTER intentionally drops some BEFORE columns
// and adds new ones - drizzle-kit pushSchema (without the rename
// resolver) will emit DROP+ADD, which is what F4's RenameDetector parses.
interface Scenario {
  name: string;
  // The fixture-suffixed table name (e.g., "dc_capture_addfield").
  tableName: (dialect: SupportedDialect) => string;
  // SQL to set up the BEFORE state. Uses dialect-specific quoting.
  beforeSql: (tableName: string, dialect: SupportedDialect) => string[];
  // The AFTER Drizzle table object the dialect's pushSchema will diff against.
  afterTable: (
    tableName: string,
    dialect: SupportedDialect
  ) => Record<string, unknown>;
}

const SCENARIOS: Scenario[] = [
  {
    name: "add-field",
    tableName: () => "dc_capture_addfield",
    beforeSql: (t, d) => [
      `CREATE TABLE ${q(t, d)} (${q("id", d)} ${intType(d)} PRIMARY KEY)`,
    ],
    afterTable: (t, d) => buildTable(t, d, { id: "int", name: "text" }),
  },
  {
    name: "drop-field",
    tableName: () => "dc_capture_dropfield",
    beforeSql: (t, d) => [
      `CREATE TABLE ${q(t, d)} (${q("id", d)} ${intType(d)} PRIMARY KEY, ${q("name", d)} ${textType(d)})`,
    ],
    afterTable: (t, d) => buildTable(t, d, { id: "int" }),
  },
  {
    name: "rename-field",
    tableName: () => "dc_capture_renamefield",
    beforeSql: (t, d) => [
      `CREATE TABLE ${q(t, d)} (${q("id", d)} ${intType(d)} PRIMARY KEY, ${q("title", d)} ${textType(d)})`,
    ],
    afterTable: (t, d) => buildTable(t, d, { id: "int", name: "text" }),
  },
  {
    name: "type-change",
    tableName: () => "dc_capture_typechange",
    beforeSql: (t, d) => [
      `CREATE TABLE ${q(t, d)} (${q("id", d)} ${intType(d)} PRIMARY KEY, ${q("age", d)} ${intType(d)})`,
    ],
    afterTable: (t, d) => buildTable(t, d, { id: "int", age: "text" }),
  },
  {
    name: "multi-rename",
    tableName: () => "dc_capture_multirename",
    beforeSql: (t, d) => [
      `CREATE TABLE ${q(t, d)} (${q("id", d)} ${intType(d)} PRIMARY KEY, ${q("a", d)} ${textType(d)}, ${q("b", d)} ${textType(d)})`,
    ],
    afterTable: (t, d) => buildTable(t, d, { id: "int", x: "text", y: "text" }),
  },
];

// Quote an identifier per dialect.
function q(name: string, dialect: SupportedDialect): string {
  return dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
}

function intType(dialect: SupportedDialect): string {
  if (dialect === "postgresql") return "integer";
  if (dialect === "mysql") return "int";
  return "integer";
}

function textType(dialect: SupportedDialect): string {
  if (dialect === "mysql") return "varchar(255)";
  return "text";
}

// Build a Drizzle table object using the dialect's table builder. cols is
// a simple {name: 'int'|'text'} map; we only need int/text for rename
// detection scenarios.
function buildTable(
  tableName: string,
  dialect: SupportedDialect,
  cols: Record<string, "int" | "text">
): Record<string, unknown> {
  if (dialect === "postgresql") {
    const shape: Record<string, unknown> = {};
    for (const [col, type] of Object.entries(cols)) {
      shape[col] = type === "int" ? pgInteger(col) : pgText(col);
    }
    return { [tableName]: pgTable(tableName, shape) };
  }
  if (dialect === "mysql") {
    const shape: Record<string, unknown> = {};
    for (const [col, type] of Object.entries(cols)) {
      shape[col] =
        type === "int" ? mysqlInt(col) : mysqlVarchar(col, { length: 255 });
    }
    return { [tableName]: mysqlTable(tableName, shape) };
  }
  // sqlite
  const shape: Record<string, unknown> = {};
  for (const [col, type] of Object.entries(cols)) {
    shape[col] = type === "int" ? sqliteInteger(col) : sqliteText(col);
  }
  return { [tableName]: sqliteTable(tableName, shape) };
}

// Per-dialect connection + pushSchema wrapper. Returns the captured result
// and a teardown function.
async function withDialectConnection<T>(
  dialect: SupportedDialect,
  fn: (deps: {
    db: unknown;
    pool: { end: () => Promise<void> } | { close: () => void };
    pushSchema: (schema: Record<string, unknown>) => Promise<{
      statementsToExecute: string[];
      warnings: string[];
      hasDataLoss: boolean;
    }>;
    runSql: (statements: string[]) => Promise<void>;
  }) => Promise<T>
): Promise<T> {
  if (dialect === "postgresql") {
    const url = process.env.TEST_POSTGRES_URL;
    if (!url) {
      throw new Error("TEST_POSTGRES_URL not set; cannot capture PG fixtures");
    }
    const { Pool } = await import("pg");
    const { drizzle } = await import("drizzle-orm/node-postgres");
    const pool = new Pool({ connectionString: url });
    const db = drizzle(pool);
    const kit = await getPgDrizzleKit();
    const pushSchema = (schema: Record<string, unknown>) =>
      kit.pushSchema(schema, db, ["public"]);
    const runSql = async (statements: string[]) => {
      for (const stmt of statements) await pool.query(stmt);
    };
    try {
      return await fn({ db, pool, pushSchema, runSql });
    } finally {
      await pool.end();
    }
  }
  if (dialect === "mysql") {
    const url = process.env.TEST_MYSQL_URL;
    if (!url) {
      throw new Error("TEST_MYSQL_URL not set; cannot capture MySQL fixtures");
    }
    const mysqlMod = await import("mysql2/promise");
    const { drizzle } = await import("drizzle-orm/mysql2");
    const pool = await mysqlMod.createPool(url);
    const db = drizzle(pool);
    const kit = await getMySQLDrizzleKit();
    // Extract database name from URL for MySQL pushSchema.
    const dbName = new URL(url).pathname.replace(/^\//, "");
    const pushSchema = (schema: Record<string, unknown>) =>
      kit.pushSchema(schema, db, dbName);
    const runSql = async (statements: string[]) => {
      for (const stmt of statements) await pool.query(stmt);
    };
    try {
      return await fn({
        db,
        pool: { end: async () => pool.end() },
        pushSchema,
        runSql,
      });
    } finally {
      await pool.end();
    }
  }
  // SQLite
  const url = process.env.TEST_SQLITE_URL ?? ":memory:";
  const { default: Database } = await import("better-sqlite3");
  const { drizzle } = await import("drizzle-orm/better-sqlite3");
  const sqlite = new Database(url);
  const db = drizzle(sqlite);
  const kit = await getSQLiteDrizzleKit();
  const pushSchema = (schema: Record<string, unknown>) =>
    kit.pushSchema(schema, db);
  const runSql = async (statements: string[]) => {
    for (const stmt of statements) sqlite.exec(stmt);
  };
  try {
    return await fn({
      db,
      pool: { close: () => sqlite.close() },
      pushSchema,
      runSql,
    });
  } finally {
    sqlite.close();
  }
}

async function captureScenario(
  scenario: Scenario,
  dialect: SupportedDialect,
  drizzleKitVersion: string
): Promise<void> {
  const tableName = scenario.tableName(dialect);
  const fixtureFile = resolve(
    FIXTURES_DIR,
    `${scenario.name}-${dialect}-drizzle-kit-${drizzleKitVersion}.json`
  );

  await withDialectConnection(dialect, async ({ db, pushSchema, runSql }) => {
    // Cleanup before, just in case prior run left state.
    await runSql([`DROP TABLE IF EXISTS ${q(tableName, dialect)}`]).catch(
      () => undefined
    );

    // Apply BEFORE state.
    await runSql(scenario.beforeSql(tableName, dialect));

    // Introspect the before-column types - embedded in the fixture so the
    // detector test can run with realistic input.
    const beforeColumnTypes = await queryLiveColumnTypes(db, dialect, [
      tableName,
    ]);

    // Build AFTER schema in memory + call pushSchema.
    const afterSchema = scenario.afterTable(tableName, dialect);
    const result = await pushSchema(afterSchema);

    // Serialize beforeColumnTypes Map to plain object for JSON.
    const serialized: Record<string, Record<string, string>> = {};
    for (const [t, cols] of beforeColumnTypes) {
      serialized[t] = Object.fromEntries(cols);
    }

    const fixture = {
      scenario: scenario.name,
      dialect,
      drizzleKitVersion,
      tableName,
      beforeColumnTypes: serialized,
      pushSchemaResult: {
        statementsToExecute: result.statementsToExecute,
        warnings: result.warnings,
        hasDataLoss: result.hasDataLoss,
      },
    };

    writeFileSync(fixtureFile, `${JSON.stringify(fixture, null, 2)}\n`);
    // eslint-disable-next-line no-console
    console.log(
      `  captured ${scenario.name} (${dialect}) -> ${
        result.statementsToExecute.length
      } stmts, ${result.warnings.length} warnings`
    );

    // Cleanup AFTER capture so the table state doesn't leak.
    await runSql([`DROP TABLE IF EXISTS ${q(tableName, dialect)}`]).catch(
      () => undefined
    );
  });
}

async function main(): Promise<void> {
  const drizzleKitVersion = readDrizzleKitVersion();
  // eslint-disable-next-line no-console
  console.log(`drizzle-kit version: ${drizzleKitVersion}`);

  const requested = process.argv[2];
  const dialects: SupportedDialect[] =
    requested === "postgresql" ||
    requested === "mysql" ||
    requested === "sqlite"
      ? [requested]
      : ["postgresql", "mysql", "sqlite"];

  for (const dialect of dialects) {
    // eslint-disable-next-line no-console
    console.log(`\n=== ${dialect} ===`);
    for (const scenario of SCENARIOS) {
      try {
        await captureScenario(scenario, dialect, drizzleKitVersion);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(
          `  FAILED ${scenario.name} (${dialect}): ${
            err instanceof Error ? err.message : String(err)
          }`
        );
        throw err;
      }
    }
  }

  // eslint-disable-next-line no-console
  console.log("\nDone.");
}

main().catch(err => {
  // eslint-disable-next-line no-console
  console.error(err);
  process.exit(1);
});
