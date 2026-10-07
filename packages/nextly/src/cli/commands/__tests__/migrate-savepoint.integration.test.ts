/**
 * A migration file that sets a savepoint and rolls back to it, run by
 * `nextly migrate` on every configured dialect.
 *
 * Each file runs whole, in the runner's one transaction. A savepoint works
 * inside that transaction and undoes at most part of the file, so the runner
 * runs it as written rather than refusing the file; a bare ROLLBACK, which
 * would end the runner's transaction, stays refused. Asked of the database,
 * because whether the partial undo happened is only visible in the rows.
 *
 * The table is created by an earlier file: MySQL commits a CREATE TABLE on
 * its own, which would end the transaction a savepoint belongs to.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { runFileMigrations } from "../migrate";

/** One migration file, in the shape `migrate:create` writes. */
function writeMigration(dir: string, name: string, up: string[]): void {
  writeFileSync(
    join(dir, `${name}.sql`),
    `-- Migration: ${name}\n\n-- UP\n${up.map(s => `${s};`).join("\n")}\n\n-- DOWN\n`,
    "utf8"
  );
}

describe.each(getConfiguredTestDialects())(
  "a savepoint inside a migration file (%s)",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // The ledger, as `nextly migrate` bootstraps it: only when absent.
      if (!(await handle.adapter.tableExists("nextly_schema_events"))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-savepoint-"));
      writeMigration(migrationsDir, "20261001_000001_marks", [
        "CREATE TABLE sp_marks (id varchar(36) PRIMARY KEY)",
      ]);
    });

    afterEach(async () => {
      await handle?.destroy();
      if (migrationsDir)
        rmSync(migrationsDir, { recursive: true, force: true });
    });

    function migrate() {
      return runFileMigrations({
        adapter: handle.adapter as unknown as Parameters<
          typeof runFileMigrations
        >[0]["adapter"],
        db: handle.adapter.getDrizzle(),
        dialect,
        migrationsDir,
        logger: createLogger({ quiet: true }),
      });
    }

    async function marks(): Promise<string[]> {
      const rows = (await handle.adapter.executeQuery(
        "SELECT id FROM sp_marks"
      )) as Array<{ id: string }>;
      return rows.map(row => row.id).sort();
    }

    it("runs the file, undoing only what follows the savepoint", async () => {
      writeMigration(migrationsDir, "20261001_000002_partial", [
        "INSERT INTO sp_marks (id) VALUES ('kept')",
        "SAVEPOINT s1",
        "INSERT INTO sp_marks (id) VALUES ('undone')",
        "ROLLBACK TO SAVEPOINT s1",
        "RELEASE SAVEPOINT s1",
        "INSERT INTO sp_marks (id) VALUES ('after')",
      ]);

      await expect(migrate()).resolves.toBe(2);

      expect(await marks()).toEqual(["after", "kept"]);
    });

    it("still refuses a bare ROLLBACK, before anything in the file runs", async () => {
      writeMigration(migrationsDir, "20261001_000002_rollback", [
        "INSERT INTO sp_marks (id) VALUES ('never')",
        "ROLLBACK",
      ]);

      await expect(migrate()).rejects.toThrow(
        /20261001_000002_rollback\.sql was refused/
      );
      expect(await marks()).toEqual([]);
    });
  }
);
