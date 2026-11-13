/**
 * `user_roles_role_id_idx` reaches a database created before it existed.
 *
 * A fresh database proves nothing here: the push that creates it always had
 * the index. The case that matters is an install that is otherwise current and
 * lacks exactly this index, so each test builds Nextly's tables with the real
 * `migrateCore`, puts the database back in the shape the earlier release left,
 * and upgrades it the two ways an install upgrades:
 *
 * - `nextly migrate`, whose engine is `migrateCore`;
 * - a development boot, which hands `migrateCore` its own deps through
 *   `migrateAtDevBoot`.
 *
 * Each must create the index and plan nothing else for `user_roles`, and a
 * second run must plan nothing at all.
 *
 * MySQL needs the earlier shape rebuilt rather than the index dropped: the
 * foreign key on `role_id` needs an index leading on that column, and with the
 * declared index present MySQL keeps no other. Before this index, the one
 * serving the key was the index MySQL made on its own, named after the
 * constraint. So the test makes that index first, and then drops the declared
 * one, which is the exact catalog an older MySQL install holds.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { migrateCore } from "../../../cli/commands/migrate";
import { createLogger } from "../../../cli/utils/logger";
import { migrateAtDevBoot } from "../../../init/boot-apply";
import { resolveRegistryNameFromCatalog } from "../../field-groups/storage/resolve-storage-names";
import { ensureSchemaEventsTable } from "../events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  type LockWorld,
} from "../pipeline/__tests__/helpers/schema-lock-world";

import { planCoreReconcile } from "./core-reconcile";
import { pluginMigrationArgs } from "./plugin/run-plugin-migrations";

const INDEX = "user_roles_role_id_idx";
const logger = createLogger({ quiet: true });

/** Rows from a raw query, whichever shape the dialect's driver returns. */
function rowsOf(result: unknown): Record<string, unknown>[] {
  const list = Array.isArray(result)
    ? result
    : ((result as { rows?: unknown[] }).rows ?? []);
  const rows = Array.isArray(list[0]) ? (list[0] as unknown[]) : list;
  return rows as Record<string, unknown>[];
}

/** The index names the database itself reports on `user_roles`. */
async function liveIndexes(adapter: DrizzleAdapter): Promise<string[]> {
  const sql =
    adapter.dialect === "postgresql"
      ? `SELECT indexname AS name FROM pg_indexes WHERE tablename = 'user_roles'`
      : adapter.dialect === "mysql"
        ? `SELECT DISTINCT index_name AS name FROM information_schema.statistics
           WHERE table_schema = DATABASE() AND table_name = 'user_roles'`
        : `SELECT name FROM pragma_index_list('user_roles')`;
  return rowsOf(await adapter.executeQuery(sql))
    .map(row => String(row.name ?? row.NAME ?? ""))
    .sort();
}

/** The name of MySQL's foreign key on `user_roles.role_id`. */
async function roleForeignKeyName(adapter: DrizzleAdapter): Promise<string> {
  const rows = rowsOf(
    await adapter.executeQuery(
      `SELECT constraint_name AS name FROM information_schema.key_column_usage
       WHERE table_schema = DATABASE() AND table_name = 'user_roles'
         AND column_name = 'role_id' AND referenced_table_name IS NOT NULL`
    )
  );
  const name = String(rows[0]?.name ?? rows[0]?.NAME ?? "");
  if (name === "") throw new Error("user_roles.role_id has no foreign key");
  return name;
}

/** Put the database back in the shape a release before the index left. */
async function removeTheIndex(adapter: DrizzleAdapter): Promise<void> {
  if (adapter.dialect === "mysql") {
    const key = await roleForeignKeyName(adapter);
    await adapter.executeQuery(`CREATE INDEX \`${key}\` ON user_roles (role_id)`);
    await adapter.executeQuery(`DROP INDEX ${INDEX} ON user_roles`);
    return;
  }
  await adapter.executeQuery(`DROP INDEX "${INDEX}"`);
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
  "user_roles_role_id_idx on an existing %s database",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;

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
        // What the boot reads from a configuration declaring no plugins.
        pluginMigrations: await pluginMigrationArgs([]),
        migrationsDir,
        logger,
        label: "[test]",
      });
    }

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-user-roles-index-"));
      await migrate();
      // The control: a database the current release builds has the index, so
      // "the upgrade created it" is a claim about an index removal undid.
      expect(await liveIndexes(adapter)).toContain(INDEX);
      await removeTheIndex(adapter);
      expect(await liveIndexes(adapter)).not.toContain(INDEX);
    }, 120_000);

    afterEach(async () => {
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    it("plans the index and nothing else, before either upgrade runs", async () => {
      const planned = await plannedStatements(adapter);

      expect(planned).toHaveLength(1);
      expect(planned[0]).toContain(INDEX);
      expect(planned[0]).toMatch(/create index/i);
    }, 60_000);

    it("gains the index through nextly migrate, and a second run plans nothing", async () => {
      const result = await migrate();

      expect(result.coreChanged).toBe(true);
      expect(await liveIndexes(adapter)).toContain(INDEX);
      expect(await plannedStatements(adapter)).toEqual([]);
      expect((await migrate()).coreChanged).toBe(false);
    }, 120_000);

    it("gains the index through a development boot, and a second boot plans nothing", async () => {
      await devBoot();

      expect(await liveIndexes(adapter)).toContain(INDEX);
      expect(await plannedStatements(adapter)).toEqual([]);
      expect((await devBoot()).coreChanged).toBe(false);
    }, 120_000);
  }
);
