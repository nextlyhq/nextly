/**
 * The live tables the drop guard credits a creation against, read from the
 * database on every configured dialect, and an app migration file judged
 * with them by `nextly migrate`.
 *
 * - `readLiveTables` names, of the tables a statement list creates, the ones
 *   that already exist, and nothing else;
 * - an app file that CREATEs a core table's existing name and then drops it
 *   is refused whole, before its first statement: the table is still there
 *   and the ledger records nothing.
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getSchemaEventsDdl } from "../../../domains/schema/events/schema-events-ddl";
import { SchemaEventsRepository } from "../../../domains/schema/events/schema-events-repository";
import { readLiveTables } from "../../../domains/schema/ownership/drop-guard";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../plugins/test-nextly";
import { createLogger } from "../../utils/logger";
import { runFileMigrations } from "../migrate";

/** The core ledger table, which the suite creates with its production DDL. */
const LEDGER = "nextly_schema_events";

describe.each(getConfiguredTestDialects())(
  "the live tables the drop guard reads (%s)",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;

    beforeEach(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      if (!(await handle.adapter.tableExists(LEDGER))) {
        for (const statement of getSchemaEventsDdl(dialect)) {
          await handle.adapter.executeQuery(statement);
        }
      }
      await handle.adapter.executeQuery(
        "CREATE TABLE lt_kept (id varchar(36) PRIMARY KEY)"
      );
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-live-tables-"));
    });

    afterEach(async () => {
      await handle?.adapter.executeQuery("DROP TABLE IF EXISTS lt_kept");
      await handle?.destroy();
      if (migrationsDir) {
        rmSync(migrationsDir, { recursive: true, force: true });
      }
    });

    it("names the created tables that already exist, and only those", async () => {
      const live = await readLiveTables(handle.adapter.getDrizzle(), dialect, [
        ["CREATE TABLE lt_kept (id INT)", "CREATE TABLE lt_new (id INT)"],
        ["CREATE TABLE scratch.lt_elsewhere (id INT)"],
      ]);
      expect([...live]).toEqual(["lt_kept"]);
    });

    it("refuses an app file that creates a core table's name before dropping it", async () => {
      writeFileSync(
        join(migrationsDir, "20261008_000001_shadow.sql"),
        `-- Migration: 20261008_000001_shadow\n\n-- UP\nCREATE TABLE ${LEDGER} (id varchar(36));\nDROP TABLE ${LEDGER};\n\n-- DOWN\n`,
        "utf8"
      );

      await expect(
        runFileMigrations({
          adapter: handle.adapter as unknown as Parameters<
            typeof runFileMigrations
          >[0]["adapter"],
          db: handle.adapter.getDrizzle(),
          dialect,
          migrationsDir,
          logger: createLogger({ quiet: true }),
        })
      ).rejects.toMatchObject({
        code: "DROP_OF_FOREIGN_TABLE",
        logContext: { table: LEDGER, belongsTo: "core" },
      });
      expect(await handle.adapter.tableExists(LEDGER)).toBe(true);
      expect(
        await new SchemaEventsRepository(
          handle.adapter.getDrizzle(),
          dialect
        ).listFileApplies()
      ).toEqual([]);
    });
  }
);
