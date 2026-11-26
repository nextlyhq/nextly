/**
 * `media.sha256` and its index reach a database created before they existed.
 *
 * A fresh database proves nothing: the push that creates it always had the
 * column. The case that matters is an install that is otherwise current and
 * lacks exactly this column, so each test builds Nextly's tables with the real
 * `migrateCore`, puts `media` back in the shape the earlier release left (no
 * column, no index, and a record stored then), and upgrades it the two ways an
 * install upgrades: `nextly migrate`, whose engine is `migrateCore`, and a
 * development boot, which hands `migrateCore` its own deps.
 *
 * Each must add the column and the index, keep the earlier record with no
 * fingerprint (the background job fills it), plan nothing else for `media`,
 * and a second run must plan nothing at all.
 */
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../../cli/commands/migrate";
import { createLogger } from "../../../../cli/utils/logger";
import { migrateAtDevBoot } from "../../../../init/boot-apply";
import { resolveRegistryNameFromCatalog } from "../../../field-groups/storage/resolve-storage-names";
import { ensureSchemaEventsTable } from "../../../schema/events/schema-events-ddl";
import { planCoreReconcile } from "../../../schema/migrate/core-reconcile";
import { pluginMigrationArgs } from "../../../schema/migrate/plugin/run-plugin-migrations";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../../../schema/pipeline/__tests__/helpers/schema-lock-world";

const COLUMN = "sha256";
const INDEX = "media_sha256_idx";
const logger = createLogger({ quiet: true });

/** Rows from a raw query, whichever shape the dialect's driver returns. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const list = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  const rows = Array.isArray(list[0]) ? (list[0] as unknown[]) : list;
  return rows as Record<string, unknown>[];
}

/** The column names the database itself reports on `media`. */
async function liveColumns(adapter: DrizzleAdapter): Promise<string[]> {
  const sql =
    adapter.dialect === "postgresql"
      ? `SELECT column_name AS name FROM information_schema.columns WHERE table_name = 'media'`
      : adapter.dialect === "mysql"
        ? `SELECT column_name AS name FROM information_schema.columns
           WHERE table_schema = DATABASE() AND table_name = 'media'`
        : `SELECT name FROM pragma_table_info('media')`;
  return rowsOf(await adapter.executeQuery(sql))
    .map(row => String(row.name ?? row.NAME ?? row.COLUMN_NAME ?? ""))
    .sort();
}

/** The index names the database itself reports on `media`. */
async function liveIndexes(adapter: DrizzleAdapter): Promise<string[]> {
  const sql =
    adapter.dialect === "postgresql"
      ? `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'media'`
      : adapter.dialect === "mysql"
        ? `SELECT DISTINCT index_name AS name FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'media'`
        : `SELECT name FROM pragma_index_list('media')`;
  return rowsOf(await adapter.executeQuery(sql))
    .map(row => String(row.name ?? row.NAME ?? row.INDEX_NAME ?? ""))
    .sort();
}

/** Put `media` back in the shape a release before the fingerprint left. */
async function removeTheColumn(adapter: DrizzleAdapter): Promise<void> {
  await adapter.executeQuery(
    adapter.dialect === "mysql"
      ? `DROP INDEX ${INDEX} ON media`
      : `DROP INDEX "${INDEX}"`
  );
  await adapter.executeQuery(
    adapter.dialect === "mysql"
      ? `ALTER TABLE media DROP COLUMN ${COLUMN}`
      : `ALTER TABLE "media" DROP COLUMN "${COLUMN}"`
  );
}

/** What the core reconcile would run now, without running it. */
async function plannedStatements(adapter: DrizzleAdapter): Promise<string[]> {
  const plan = await planCoreReconcile({
    db: adapter.getDrizzle(),
    dialect: adapter.dialect,
    fieldGroupRegistryTable: await resolveRegistryNameFromCatalog(adapter),
  });
  return plan.statements;
}

describe.each(LOCK_DIALECTS)(
  "media.sha256 on an existing %s database",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    let earlier: string;

    /** `nextly migrate`'s engine, as the command hands it its deps. */
    function migrate() {
      return migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 30_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
    }

    /** The development boot's migrate step, as the boot hands it its deps. */
    async function devBoot() {
      return migrateAtDevBoot({
        migrateCore,
        adapter,
        extensionSchema: undefined,
        pluginMigrations: await pluginMigrationArgs([]),
        migrationsDir,
        logger,
        label: "[test]",
      });
    }

    /** What the database holds for the earlier record, read raw. */
    async function earlierRecord(): Promise<Record<string, unknown>> {
      const [row] = rowsOf(
        await adapter.executeQuery(
          `SELECT * FROM media WHERE id = '${earlier}'`
        )
      );
      return row;
    }

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-media-hash-"));
      await migrate();
      // The control: a database the current release builds has both, so
      // "the upgrade added them" is a claim about what the removal undid.
      expect(await liveColumns(adapter)).toContain(COLUMN);
      expect(await liveIndexes(adapter)).toContain(INDEX);
      await removeTheColumn(adapter);
      expect(await liveColumns(adapter)).not.toContain(COLUMN);
      expect(await liveIndexes(adapter)).not.toContain(INDEX);
      earlier = randomUUID();
      await adapter.executeQuery(
        `INSERT INTO media (id, filename, original_filename, mime_type, size, url, uploaded_at, updated_at)
         VALUES ('${earlier}', 'earlier.txt', 'earlier.txt', 'text/plain', 5, '/uploads/earlier.txt', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
      );
    }, 120_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    it("plans the column and its index, and nothing that drops or rewrites media", async () => {
      const planned = await plannedStatements(adapter);

      expect(planned.some(s => /sha256/i.test(s) && /add/i.test(s))).toBe(true);
      expect(planned.some(s => s.includes(INDEX))).toBe(true);
      for (const statement of planned) {
        expect(statement).not.toMatch(/drop table|drop column/i);
      }
    }, 60_000);

    it("gains the column through nextly migrate, keeps the earlier record, and a second run plans nothing", async () => {
      const result = await migrate();

      expect(result.coreChanged).toBe(true);
      expect(await liveColumns(adapter)).toContain(COLUMN);
      expect(await liveIndexes(adapter)).toContain(INDEX);
      const row = await earlierRecord();
      expect(row?.filename).toBe("earlier.txt");
      expect(row?.sha256 ?? null).toBeNull();
      expect(await plannedStatements(adapter)).toEqual([]);
      expect((await migrate()).coreChanged).toBe(false);
    }, 120_000);

    it("gains the column through a development boot, and a second boot plans nothing", async () => {
      await devBoot();

      expect(await liveColumns(adapter)).toContain(COLUMN);
      expect(await liveIndexes(adapter)).toContain(INDEX);
      expect((await earlierRecord())?.filename).toBe("earlier.txt");
      expect(await plannedStatements(adapter)).toEqual([]);
      expect((await devBoot()).coreChanged).toBe(false);
    }, 120_000);
  }
);
