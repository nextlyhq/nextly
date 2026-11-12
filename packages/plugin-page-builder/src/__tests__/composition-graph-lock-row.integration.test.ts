/**
 * The composition graph lock's row, on every configured dialect: a start
 * puts nothing in place for it, and a write locking the graph still works
 * where the row is missing.
 *
 * The row is put in place once, by the plugin's data migration, on install
 * and on `nextly migrate` for an existing install (the upgrade suite,
 * `breakpoint-removals-migration`, shows that). A start used to insert it
 * every time, and on PostgreSQL and MySQL, where it was already there, the
 * insert failed on the unique name: a wasted round trip and an error in the
 * database's log on every start.
 *
 * What separates a correct start from a plausible broken one:
 * - starting against a database holding the row sends no insert into the
 *   plugin's options table: a start that inserts, or tries and swallows the
 *   duplicate, sends one;
 * - with the row missing, a page's save takes the lock as before, and leaves
 *   the row in place where the dialect takes a row lock.
 *
 * Each statement is logged at the driver (`statement-log`). The database
 * starting twice is one of the suite's own (`scratch-database`).
 *
 * @module __tests__/composition-graph-lock-row.integration.test
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createTestNextly,
  getConfiguredTestDialects,
  type TestDialect,
  type TestNextly,
} from "@nextlyhq/plugin-sdk/testing";
import { createAdapter } from "nextly/database";
import { afterEach, describe, expect, it, vi } from "vitest";

import { pageBuilder } from "../plugin";
import { SCHEMA_PREFIX, siteOptions } from "../schema/tables";

import { savePage, startupSettled } from "./entry-page-claims-harness";
import { scratchDatabase, type ScratchDatabase } from "./scratch-database";
import { naming, openStatementLog } from "./statement-log";

/** The plugin's options table, as the database names it. */
const OPTIONS_TABLE = `${SCHEMA_PREFIX}__${siteOptions.name}`;

/** The lock's row's name in it. */
const GRAPH_LOCK_ROW = "composition-graph-lock";

/** The lock's rows, as `<name>`, through the instance's own adapter. */
async function lockRows(
  t: TestNextly,
  dialect: TestDialect
): Promise<string[]> {
  const quote = (name: string) =>
    dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
  const found = await t.adapter.executeQuery<{ name: unknown }>(
    `SELECT ${quote("name")} FROM ${quote(OPTIONS_TABLE)} WHERE ${quote("name")} = '${GRAPH_LOCK_ROW}'`
  );
  return found.map(row => String(row.name));
}

describe.each(getConfiguredTestDialects())(
  "the composition graph lock's row (%s)",
  (dialect: TestDialect) => {
    let current: TestNextly | undefined;
    let database: ScratchDatabase | undefined;
    let folder: string | undefined;

    afterEach(async () => {
      await current?.destroy();
      current = undefined;
      await database?.drop();
      database = undefined;
      if (folder !== undefined)
        rmSync(folder, { recursive: true, force: true });
      folder = undefined;
      vi.unstubAllEnvs();
    });

    /**
     * An adapter on `on`, for one boot. Core reads its environment when an
     * adapter is made and when a site boots, so it names this database for
     * the whole case.
     */
    function adapterOn(on: ScratchDatabase) {
      vi.stubEnv("DATABASE_URL", on.url);
      vi.stubEnv("DB_DIALECT", on.dialect);
      vi.stubEnv("NEXTLY_SECRET", undefined);
      return createAdapter({ type: on.dialect, url: on.url });
    }

    it("a start against a database holding the row puts nothing into the options table", async () => {
      folder = mkdtempSync(join(tmpdir(), "pb-graph-lock-"));
      database = await scratchDatabase(dialect, folder);

      // The install, holding the row where the dialect takes a row lock, as
      // the plugin's migration leaves it, and every option its first start
      // records (the site's spacing model) recorded before it stops.
      const installing = await adapterOn(database);
      const first = await openStatementLog(installing, dialect);
      try {
        current = await createTestNextly({
          adapter: installing,
          plugins: [pageBuilder()],
        });
        await startupSettled(current);
        await current.events.settle();
        await first.quiet();
      } finally {
        first.close();
      }
      if (
        dialect !== "sqlite" &&
        (await lockRows(current, dialect)).length === 0
      ) {
        await current.adapter.executeQuery(
          `INSERT INTO ${dialect === "mysql" ? `\`${OPTIONS_TABLE}\`` : `"${OPTIONS_TABLE}"`} (id, name, value) VALUES ('graph-lock', '${GRAPH_LOCK_ROW}', 'installed')`
        );
      }
      await current.destroy();
      current = undefined;

      // It starts again, every statement logged from before the boot until
      // its start-up passes are over.
      const adapter = await adapterOn(database);
      const log = await openStatementLog(adapter, dialect);
      try {
        current = await createTestNextly({
          adapter,
          plugins: [pageBuilder()],
        });
        await startupSettled(current);
        await current.events.settle();
        await log.quiet();
      } finally {
        log.close();
      }

      // CONTROL: the log saw the start's background passes, which read the
      // published pages after the boot resolves.
      expect(naming(log.statements, "dc_pages")).not.toEqual([]);
      expect(
        naming(log.statements, OPTIONS_TABLE).filter(statement =>
          /^\s*insert\b/i.test(statement)
        )
      ).toEqual([]);
      // Nor is a statement on it refused, a duplicate key above all.
      expect(naming(log.refused, OPTIONS_TABLE)).toEqual([]);
      expect(await lockRows(current, dialect)).toEqual(
        dialect === "sqlite" ? [] : [GRAPH_LOCK_ROW]
      );
    });

    it("with the row missing, a page's save takes the lock and leaves the row in place", async () => {
      current = await createTestNextly({
        ...(dialect === "sqlite" ? {} : { dialect }),
        plugins: [pageBuilder()],
      });
      await startupSettled(current);
      const quote = (name: string) =>
        dialect === "mysql" ? `\`${name}\`` : `"${name}"`;
      await current.adapter.executeQuery(
        `DELETE FROM ${quote(OPTIONS_TABLE)} WHERE ${quote("name")} = '${GRAPH_LOCK_ROW}'`
      );
      expect(await lockRows(current, dialect)).toEqual([]);

      const saved = (await savePage(current, "Home", "home")) as {
        item?: { id?: unknown };
      };
      expect(saved.item?.id).toBeDefined();
      // A second save finds the row and locks it.
      await savePage(current, "About", "about");

      expect(await lockRows(current, dialect)).toEqual(
        dialect === "sqlite" ? [] : [GRAPH_LOCK_ROW]
      );
    });
  }
);
