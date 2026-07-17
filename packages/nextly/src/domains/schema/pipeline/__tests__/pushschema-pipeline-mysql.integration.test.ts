// MySQL end-to-end pipeline apply against a real MySQL server.
//
// Regression pinned here: Phase D used to hand the drizzle TRANSACTION
// object to the kit, but drizzle-orm's MySql2Transaction has no `$client`
// (only the top-level instance does), so EVERY MySQL apply that reached
// drizzle-kit crashed in the mysql shim. The pipeline now passes the outer
// db on MySQL (DDL auto-commits there, so tx-scoped introspection buys
// nothing) — this suite fails if that regresses. Auto-skips without
// TEST_MYSQL_URL (docker compose -f docker-compose.test.yml up -d).

import { randomBytes } from "node:crypto";

import { drizzle } from "drizzle-orm/mysql2";
import { createPool, type Pool } from "mysql2";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { RealClassifier } from "../classifier/classifier";
import { RealPreCleanupExecutor } from "../pre-cleanup/executor";
import { PushSchemaPipeline } from "../pushschema-pipeline";
import {
  noopClassifier,
  noopMigrationJournal,
  noopNotifier,
  noopPreRenameExecutor,
  noopPromptDispatcher,
  noopRenameDetector,
} from "../pushschema-pipeline-stubs";
import { RegexRenameDetector } from "../rename-detector";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import type { DesiredSchema } from "../types";

const MYSQL_URL = process.env.TEST_MYSQL_URL;
// Unique per-run database name — a fixed name could collide with (and the
// pre-drop could destroy) a concurrent run's database. Hex suffix keeps it
// a safe identifier, so interpolating it into DDL is not an injection
// surface.
const DB_NAME = `nextly_pipeline_mysql_${randomBytes(4).toString("hex")}`;

describe.skipIf(!MYSQL_URL)("PushSchemaPipeline integration — MySQL", () => {
  let bootstrap: Pool;
  let pool: Pool;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    bootstrap = createPool({ uri: MYSQL_URL });
    await bootstrap.promise().query(`CREATE DATABASE ${DB_NAME}`);
    const url = new URL(MYSQL_URL as string);
    url.pathname = `/${DB_NAME}`;
    pool = createPool({ uri: url.toString() });
    db = drizzle({ client: pool });
  });

  afterAll(async () => {
    await new Promise<void>(res => pool.end(() => res()));
    await bootstrap
      .promise()
      .query(`DROP DATABASE IF EXISTS ${DB_NAME}`)
      .catch(() => {});
    await new Promise<void>(res => bootstrap.end(() => res()));
  });

  it("additive apply reaches the real kit through Phase D and lands the column", async () => {
    const p = pool.promise();
    await p.query(
      `CREATE TABLE dc_posts_my (
        id varchar(64) PRIMARY KEY,
        title varchar(255) NOT NULL,
        slug varchar(255) NOT NULL,
        created_at datetime,
        updated_at datetime
      )`
    );

    const pipeline = new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("mysql", db),
      renameDetector: new RegexRenameDetector(),
      classifier: new RealClassifier(),
      promptDispatcher: noopPromptDispatcher,
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: new RealPreCleanupExecutor(),
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });

    const desired: DesiredSchema = {
      collections: {
        posts: {
          slug: "posts",
          tableName: "dc_posts_my",
          fields: [{ name: "body", type: "text" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "mysql",
      source: "code",
      promptChannel: "terminal",
      databaseName: DB_NAME,
    });

    expect(result.success).toBe(true);
    const [cols] = (await p.query(
      "SELECT column_name AS column_name FROM information_schema.columns WHERE table_schema = DATABASE() AND table_name = 'dc_posts_my'"
    )) as unknown as [Array<{ column_name: string }>];
    expect(cols.map(c => c.column_name)).toContain("body");
  });

  it("rename with data preserves the row through pre-resolution", async () => {
    const p = pool.promise();
    await p.query(`DROP TABLE IF EXISTS dc_people_my`);
    await p.query(
      `CREATE TABLE dc_people_my (
        id varchar(64) PRIMARY KEY,
        title varchar(255) NOT NULL,
        slug varchar(255) NOT NULL,
        created_at datetime,
        updated_at datetime,
        nickname text
      )`
    );
    await p.query(
      "INSERT INTO dc_people_my (id, title, slug, nickname) VALUES ('p1', 't', 'p-1', 'keep-me')"
    );

    const pipeline = new PushSchemaPipeline({
      executor: new DrizzleStatementExecutor("mysql", db),
      renameDetector: new RegexRenameDetector(),
      classifier: noopClassifier,
      promptDispatcher: {
        dispatch: async ({ candidates }) => ({
          confirmedRenames: [...candidates],
          resolutions: [],
          proceed: true,
        }),
      },
      preRenameExecutor: noopPreRenameExecutor,
      preCleanupExecutor: new RealPreCleanupExecutor(),
      migrationJournal: noopMigrationJournal,
      notifier: noopNotifier,
    });

    const desired: DesiredSchema = {
      collections: {
        people: {
          slug: "people",
          tableName: "dc_people_my",
          fields: [{ name: "name", type: "textarea" }] as never,
        },
      },
      singles: {},
      components: {},
    };

    const result = await pipeline.apply({
      desired,
      db,
      dialect: "mysql",
      source: "code",
      promptChannel: "terminal",
      databaseName: DB_NAME,
    });

    expect(result.success).toBe(true);
    expect(result.renamesApplied).toBe(1);
    const [rows] = (await p.query(
      "SELECT name FROM dc_people_my WHERE id = 'p1'"
    )) as unknown as [Array<{ name: string }>];
    expect(rows[0]?.name).toBe("keep-me");
  });
});
