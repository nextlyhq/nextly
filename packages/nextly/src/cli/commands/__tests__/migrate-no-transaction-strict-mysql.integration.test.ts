/**
 * `nextly migrate` runs a file marked `-- nextly:no-transaction` in MySQL
 * strict mode, as it runs every transactional file, whatever the server's own
 * mode is.
 *
 * Without strict mode MySQL cuts an overlong value to a narrowed column's
 * length with only a warning, and a migration runs with nobody there to read
 * it. A file marked to run outside a transaction runs statement by statement,
 * each committing as it runs, so its statements share one connection whose
 * session is put in strict mode, and that connection is closed afterwards
 * rather than pooled, so strict mode reaches nothing else.
 *
 * One pooled connection, set to no strict mode, stands for a server
 * configured that way: the runner gets that connection, and the pool's next
 * connection is a different one.
 *
 * Self-skips when TEST_MYSQL_URL is unset.
 */
import { randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import mysql from "mysql2/promise";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createAdapter } from "../../../database/factory";
import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { NextlyError } from "../../../errors/nextly-error";
import { createLogger } from "../../utils/logger";
import { runFileMigrations } from "../migrate";

const MYSQL_URL = process.env.TEST_MYSQL_URL ?? "";
const describeMysql = describe.skipIf(!MYSQL_URL);

const RUN_ID = randomBytes(3).toString("hex");
const TABLE = "nt_strict_notes";
const LONG = "x".repeat(300);

const logger = createLogger({ quiet: true });

let seq = 0;

describeMysql(
  "a migration file marked to run outside a transaction, on MySQL",
  () => {
    let root: mysql.Connection;
    let dbName: string;
    let url: string;
    let dir: string;
    let lax: DrizzleAdapter;

    beforeEach(async () => {
      dbName = `nextly_nt_strict_${RUN_ID}_${seq++}`;
      const server = new URL(MYSQL_URL);
      server.pathname = "/";
      root = await mysql.createConnection(server.toString());
      await root.query(`CREATE DATABASE \`${dbName}\``);
      await root.query(`USE \`${dbName}\``);
      await root.query(`CREATE TABLE ${TABLE} (id int PRIMARY KEY, v TEXT)`);
      await root.query(`INSERT INTO ${TABLE} (id, v) VALUES (1, ?)`, [LONG]);
      const u = new URL(MYSQL_URL);
      u.pathname = `/${dbName}`;
      url = u.toString();
      dir = mkdtempSync(join(tmpdir(), "nextly-nt-strict-"));
      mkdirSync(join(dir, "migrations"));
      lax = (await createAdapter({
        type: "mysql",
        url,
        pool: { max: 1 },
      } as Parameters<typeof createAdapter>[0])) as unknown as DrizzleAdapter;
      // The ledger, as `nextly migrate` bootstraps it.
      for (const statement of getSchemaEventsDdl("mysql")) {
        await lax.executeQuery(statement);
      }
      await lax.executeQuery("SET SESSION sql_mode = ''");
    });

    afterEach(async () => {
      await lax?.disconnect();
      await root?.query(`DROP DATABASE IF EXISTS \`${dbName}\``);
      await root?.end();
      if (dir) rmSync(dir, { recursive: true, force: true });
    });

    function writeMarked(name: string, up: string[]): void {
      writeFileSync(
        join(dir, "migrations", `${name}.sql`),
        `-- nextly:no-transaction\n-- Migration: ${name}\n\n-- UP\n${up
          .map(s => `${s};`)
          .join("\n")}\n\n-- DOWN\n`,
        "utf8"
      );
    }

    function migrate() {
      return runFileMigrations({
        adapter: lax as unknown as Parameters<
          typeof runFileMigrations
        >[0]["adapter"],
        db: lax.getDrizzle(),
        dialect: "mysql",
        migrationsDir: join(dir, "migrations"),
        logger,
      });
    }

    async function stored(): Promise<{ type: string; length: number }> {
      const [cols] = await root.query<mysql.RowDataPacket[]>(
        "SELECT DATA_TYPE AS type FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = 'v'",
        [dbName, TABLE]
      );
      const [rows] = await root.query<mysql.RowDataPacket[]>(
        `SELECT CHAR_LENGTH(v) AS n FROM ${TABLE} WHERE id = 1`
      );
      return { type: String(cols[0]?.type), length: Number(rows[0]?.n) };
    }

    async function connectionId(): Promise<number> {
      const [row] = await lax.executeQuery<{ id: number }>(
        "SELECT CONNECTION_ID() AS id"
      );
      return Number(row.id);
    }

    it("refuses a narrowing that would cut a stored value, keeps the value, and closes the strict connection", async () => {
      const laxId = await connectionId();
      writeMarked(`20261021_000000_${RUN_ID}_narrow`, [
        `ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(255)`,
      ]);

      const thrown = await migrate().then(
        () => undefined,
        (caught: unknown) => caught
      );

      expect(thrown).toBeInstanceOf(NextlyError);
      const error = thrown as NextlyError;
      expect(error.code).toBe("NEXTLY_MIGRATION_PARTIALLY_APPLIED");
      expect(error.logMessage).toMatch(/Data too long/);
      expect(await stored()).toEqual({ type: "text", length: 300 });
      expect(await connectionId()).not.toBe(laxId);
    });

    it("applies a narrowing every stored value fits", async () => {
      await root.query(`UPDATE ${TABLE} SET v = 'short' WHERE id = 1`);
      writeMarked(`20261021_000001_${RUN_ID}_narrow_fits`, [
        `ALTER TABLE ${TABLE} MODIFY COLUMN v varchar(255)`,
      ]);

      await migrate();

      expect(await stored()).toEqual({ type: "varchar", length: 5 });
    });
  }
);
