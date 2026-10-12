/**
 * `nextly migrate` with `NEXTLY_DROP_RETIRED_AUTH_TABLES=1`, against a real
 * database on every configured dialect.
 *
 * The unit suite beside this one fakes the catalogue, the row count and the
 * statement. Each of those is dialect-specific in production — which tables
 * exist, what columns a table has, how a table is counted and how it is
 * dropped — so this runs the migrate core as the command does, through the
 * operations it builds from the adapter, and reads the outcome back from the
 * database.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import {
  createHostAccountsTable,
  createRetiredAuthTables,
  dropRetiredAuthTables,
  insertRow,
} from "../../../../init/__tests__/retired-auth-tables-fixture";
import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestNextly,
} from "../../../../plugins/test-nextly";
import { getSchemaEventsDdl } from "../../events/schema-events-ddl";

/** A logger that keeps the warnings, which is where kept tables are named. */
function recordingLogger() {
  const warnings: string[] = [];
  const quiet = () => {};
  const logger = {
    info: quiet,
    debug: quiet,
    success: quiet,
    error: quiet,
    newline: quiet,
    keyValue: quiet,
    divider: quiet,
    warn: (message: string) => {
      warnings.push(message);
    },
  };
  return { logger, warnings };
}

describe.each(getConfiguredTestDialects())(
  "the retired auth tables under nextly migrate (%s)",
  dialect => {
    let handle: TestNextly;
    let migrationsDir: string;

    beforeAll(async () => {
      handle = await createTestNextly(dialect === "sqlite" ? {} : { dialect });
      // No migration files: the run is about Phase 1's cleanup alone.
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-retired-drop-"));
    });

    afterAll(async () => {
      await handle?.destroy();
      rmSync(migrationsDir, { recursive: true, force: true });
    });

    afterEach(async () => {
      await dropRetiredAuthTables(handle.adapter);
    });

    /** Run the migrate core as the command does, with the drop requested. */
    async function migrate(options: { allowDropNonEmptyRetired?: boolean }) {
      const { logger, warnings } = recordingLogger();
      const adapter = handle.adapter;
      await migrateCore({
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as unknown as Parameters<
          typeof migrateCore
        >[0]["adapter"],
        migrationsDir,
        logger: logger as unknown as Parameters<
          typeof migrateCore
        >[0]["logger"],
        dropRetiredAuthTables: true,
        ...options,
        // As the command bootstraps the ledger: only when it is not there.
        ensureLedger: async () => {
          if (await adapter.tableExists("nextly_schema_events")) return;
          for (const statement of getSchemaEventsDdl(dialect)) {
            await adapter.executeQuery(statement);
          }
        },
      });
      return warnings;
    }

    it("drops both tables in Nextly's shape when they are empty", async () => {
      await createRetiredAuthTables(handle.adapter, dialect);

      await migrate({});

      expect(await handle.adapter.tableExists("accounts")).toBe(false);
      expect(await handle.adapter.tableExists("sessions")).toBe(false);
    });

    it("keeps a table that still holds rows, and drops the empty one", async () => {
      // The control for the case above: a drop that ignored the row count
      // would pass it, and lose the rows here.
      await createRetiredAuthTables(handle.adapter, dialect);
      await insertRow(handle.adapter, dialect, "accounts", [
        "a-1",
        "someone",
        "oauth",
        "google",
        "g-1",
        "tok",
      ]);

      const warnings = await migrate({});

      expect(await handle.adapter.tableExists("accounts")).toBe(true);
      expect(await handle.adapter.tableExists("sessions")).toBe(false);
      expect(warnings.join("\n")).toContain("accounts");
    });

    it("drops a table holding rows once losing them is allowed", async () => {
      await createRetiredAuthTables(handle.adapter, dialect);
      await insertRow(handle.adapter, dialect, "accounts", [
        "a-1",
        "someone",
        "oauth",
        "google",
        "g-1",
        "tok",
      ]);

      await migrate({ allowDropNonEmptyRetired: true });

      expect(await handle.adapter.tableExists("accounts")).toBe(false);
    });

    it("leaves a host app's table of the same name alone", async () => {
      // Empty, so only the shape check stands between it and the drop.
      await createHostAccountsTable(handle.adapter, dialect);

      await migrate({ allowDropNonEmptyRetired: true });

      expect(await handle.adapter.tableExists("accounts")).toBe(true);
    });
  }
);
