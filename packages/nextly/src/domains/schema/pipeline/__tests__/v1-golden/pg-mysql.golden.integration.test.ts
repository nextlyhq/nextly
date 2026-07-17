// Phase 7 Task 1 — PostgreSQL + MySQL golden fixtures for drizzle-kit v1
// pushSchema. See golden-harness.ts for why. Needs the docker test DBs
// (docker compose -f docker-compose.test.yml up -d); auto-skips without env.
//
// D3 data collection: each PG scenario logs the kit's wall-clock introspect+
// diff time ([D3] lines) — input for the later keep/retire decision on the
// fast-path DDL emitter. No decision is taken here.

import { performance } from "node:perf_hooks";

import { drizzle as drizzleMysql } from "drizzle-orm/mysql2";
import {
  index as mysqlIndex,
  int as mysqlInt,
  mysqlTable,
  varchar,
} from "drizzle-orm/mysql-core";
import { drizzle as drizzlePg } from "drizzle-orm/node-postgres";
import {
  index as pgIndex,
  integer as pgInteger,
  pgTable,
  text as pgText,
} from "drizzle-orm/pg-core";
import { createPool, type Pool as MysqlPool } from "mysql2";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  getMySQLDrizzleKit,
  getPgDrizzleKit,
} from "../../../../../database/drizzle-kit-lazy";

import {
  assertTextConsumers,
  fixturePath,
  serializeCapture,
  type GoldenScenario,
} from "./golden-harness";

// ─────────────────────────────── PostgreSQL ───────────────────────────────

const PG_URL = process.env.TEST_POSTGRES_URL;

const pgScenarios: GoldenScenario[] = [
  {
    name: "add-table",
    seed: [],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        title: pgText("title"),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "add-column",
    seed: ['CREATE TABLE "vg1" (id text PRIMARY KEY, title text)'],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        title: pgText("title"),
        extra: pgText("extra"),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "drop-column",
    seed: ['CREATE TABLE "vg1" (id text PRIMARY KEY, title text, extra text)'],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        title: pgText("title"),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "some",
    expectFilterBlocks: [],
  },
  {
    name: "type-change",
    seed: ['CREATE TABLE "vg1" (id text PRIMARY KEY, num text)'],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        num: pgInteger("num"),
      }),
    }),
    desiredTableNames: ["vg1"],
    // PG emits SET DATA TYPE … USING — in-place, not destructive.
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-add",
    seed: ['CREATE TABLE "vg1" (id text PRIMARY KEY, title text)'],
    desired: () => ({
      vg1: pgTable(
        "vg1",
        {
          id: pgText("id").primaryKey(),
          title: pgText("title"),
        },
        t => [pgIndex("vg1_title_idx").on(t.title)]
      ),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-drop",
    seed: [
      'CREATE TABLE "vg1" (id text PRIMARY KEY, title text)',
      'CREATE INDEX "vg1_title_idx" ON "vg1" (title)',
    ],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        title: pgText("title"),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "orphan-table-drop",
    seed: [
      'CREATE TABLE "vg1" (id text PRIMARY KEY, title text)',
      'CREATE TABLE "vg_orphan" (id text PRIMARY KEY)',
    ],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        title: pgText("title"),
      }),
    }),
    desiredTableNames: ["vg1"],
    // The orphan must be IN the kit's entities filter for the kit to see it
    // at all — mirroring the pipeline case where the desired schema narrowed
    // between runs.
    extraFilterTables: ["vg_orphan"],
    expectDestructiveOffenders: "some",
    expectFilterBlocks: ["vg_orphan"],
  },
  {
    name: "rename-shape-crash",
    seed: ['CREATE TABLE "vg1" (id text PRIMARY KEY, title text)'],
    desired: () => ({
      vg1: pgTable("vg1", {
        id: pgText("id").primaryKey(),
        name: pgText("name"),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
    throws: /HintsHandler/,
  },
];

describe.skipIf(!PG_URL)("v1 golden SQL — PostgreSQL", () => {
  let pool: Pool;

  beforeAll(() => {
    pool = new Pool({ connectionString: PG_URL });
  });

  afterAll(async () => {
    await pool
      .query('DROP TABLE IF EXISTS "vg1", "vg_orphan" CASCADE')
      .catch(() => {});
    await pool.end();
  });

  for (const scenario of pgScenarios) {
    it(`captures + classifies: ${scenario.name}`, async () => {
      await pool.query('DROP TABLE IF EXISTS "vg1", "vg_orphan" CASCADE');
      for (const stmt of scenario.seed) await pool.query(stmt);

      const db = drizzlePg({ client: pool });
      const kit = await getPgDrizzleKit();
      const filterTables = [
        ...scenario.desiredTableNames,
        ...(scenario.extraFilterTables ?? []),
      ];

      if (scenario.throws) {
        await expect(
          kit.pushSchema(scenario.desired(), db, {
            schemas: ["public"],
            tables: filterTables,
          })
        ).rejects.toThrow(scenario.throws);
        return;
      }

      const t0 = performance.now();
      const result = await kit.pushSchema(scenario.desired(), db, {
        schemas: ["public"],
        tables: filterTables,
      });
      const kitMs = Math.round(performance.now() - t0);
      // D3 data point (kit introspect+diff wall time on a near-empty DB).
      console.info(`[D3] pg ${scenario.name}: kit pushSchema ${kitMs}ms`);

      const captured = {
        sqlStatements: result.sqlStatements,
        hints: result.hints,
      };
      await expect(serializeCapture(captured)).toMatchFileSnapshot(
        fixturePath("pg", scenario.name)
      );
      assertTextConsumers(scenario, captured);
    });
  }
});

// ───────────────────────────────── MySQL ──────────────────────────────────

const MYSQL_URL = process.env.TEST_MYSQL_URL;
// Dedicated database so goldens never see tables other suites left in
// nextly_test (MySQL pushSchema has no per-table filter).
const GOLDEN_DB = "nextly_golden";

const mysqlScenarios: GoldenScenario[] = [
  {
    name: "add-table",
    seed: [],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        title: varchar("title", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "add-column",
    seed: ["CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255))"],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        title: varchar("title", { length: 255 }),
        extra: varchar("extra", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "drop-column",
    seed: [
      "CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255), extra varchar(255))",
    ],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        title: varchar("title", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "some",
    expectFilterBlocks: [],
  },
  {
    name: "type-change",
    seed: ["CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, num varchar(255))"],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        num: mysqlInt("num"),
      }),
    }),
    desiredTableNames: ["vg1"],
    // MySQL MODIFY COLUMN — in-place, not matched by the scanner.
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-add",
    seed: ["CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255))"],
    desired: () => ({
      vg1: mysqlTable(
        "vg1",
        {
          id: varchar("id", { length: 64 }).primaryKey(),
          title: varchar("title", { length: 255 }),
        },
        t => [mysqlIndex("vg1_title_idx").on(t.title)]
      ),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "index-drop",
    seed: [
      "CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255))",
      "CREATE INDEX vg1_title_idx ON vg1 (title)",
    ],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        title: varchar("title", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
  },
  {
    name: "orphan-table-drop",
    seed: [
      "CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255))",
      "CREATE TABLE vg_orphan (id varchar(64) PRIMARY KEY)",
    ],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        title: varchar("title", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "some",
    expectFilterBlocks: ["vg_orphan"],
  },
  {
    name: "rename-shape-crash",
    seed: ["CREATE TABLE vg1 (id varchar(64) PRIMARY KEY, title varchar(255))"],
    desired: () => ({
      vg1: mysqlTable("vg1", {
        id: varchar("id", { length: 64 }).primaryKey(),
        name: varchar("name", { length: 255 }),
      }),
    }),
    desiredTableNames: ["vg1"],
    expectDestructiveOffenders: "none",
    expectFilterBlocks: [],
    throws: /HintsHandler/,
  },
];

describe.skipIf(!MYSQL_URL)("v1 golden SQL — MySQL", () => {
  let bootstrapPool: MysqlPool;
  let pool: MysqlPool;

  beforeAll(async () => {
    bootstrapPool = createPool({ uri: MYSQL_URL });
    await bootstrapPool
      .promise()
      .query(`CREATE DATABASE IF NOT EXISTS ${GOLDEN_DB}`);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${GOLDEN_DB}`;
    pool = createPool({ uri: url.toString() });
  });

  afterAll(async () => {
    await bootstrapPool
      .promise()
      .query(`DROP DATABASE IF EXISTS ${GOLDEN_DB}`)
      .catch(() => {});
    await new Promise<void>(res => pool.end(() => res()));
    await new Promise<void>(res => bootstrapPool.end(() => res()));
  });

  for (const scenario of mysqlScenarios) {
    it(`captures + classifies: ${scenario.name}`, async () => {
      const p = pool.promise();
      await p.query("DROP TABLE IF EXISTS vg1");
      await p.query("DROP TABLE IF EXISTS vg_orphan");
      for (const stmt of scenario.seed) await p.query(stmt);

      const db = drizzleMysql({ client: pool });
      const kit = await getMySQLDrizzleKit();

      if (scenario.throws) {
        await expect(
          kit.pushSchema(scenario.desired(), db, GOLDEN_DB)
        ).rejects.toThrow(scenario.throws);
        return;
      }

      const result = await kit.pushSchema(scenario.desired(), db, GOLDEN_DB);
      const captured = {
        sqlStatements: result.sqlStatements,
        hints: result.hints,
      };
      await expect(serializeCapture(captured)).toMatchFileSnapshot(
        fixturePath("mysql", scenario.name)
      );
      assertTextConsumers(scenario, captured);
    });
  }
});
