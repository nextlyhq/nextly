/**
 * `nextly permissions:cleanup` holds the schema lock for the whole of its work.
 *
 * A permission is orphaned when no registered collection, single or component names its resource,
 * so the cleanup is a judgement on the registry. Each case seeds the permissions of a collection
 * the registry does not hold, then runs the command's core:
 *
 * - with the lock free, it deletes them (the control: the fixture reaches the deletion);
 * - with another process holding the lock, it is refused and the database is as it was;
 * - while it waits for a held lock, the collection is registered; once it holds the lock it reads
 *   the registry as it stands then, so the permissions are no longer orphaned and are kept. A run
 *   that read the registry before taking the lock would delete them.
 *
 * Each dialect runs on a database of its own, because the core reconcile builds the system tables.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { PermissionSeedService } from "../../../domains/auth/services/permission-seed-service";
import { CollectionRegistryService } from "../../../domains/collections/services/collection-registry-service";
import { hashManifest } from "../../../domains/field-groups/migration/manifest";
import { beginMigration } from "../../../domains/field-groups/migration/state";
import { MetaService } from "../../../domains/meta/services/meta-service";
import { ensureSchemaEventsTable } from "../../../domains/schema/events/schema-events-ddl";
import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  startHolder,
  type Holder,
  type LockWorld,
} from "../../../domains/schema/pipeline/__tests__/helpers/schema-lock-world";
import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../shared/types";
import { toCliError } from "../../errors";
import { createLogger } from "../../utils/logger";
import { migrateCore } from "../migrate";
import {
  cleanupOrphanedPermissionsUnderLock,
  runPermissionsCleanup,
} from "../permissions-cleanup";

/** A collection slug the registry does not hold until a case registers it. */
const GHOST = "pclk_ghost";

/** Every table a lock keeps its row in, as `world.reset` drops them. */
const LOCK_TABLES = [
  "nextly_schema_lock",
  "nextly_field_group_lock",
  "nextly_migrate_lock",
];

const logger = createLogger({ quiet: true });
const serviceLogger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
};

describe.each(LOCK_DIALECTS)(
  "permissions:cleanup and the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;
    let migrationsDir: string;
    let holder: Holder | undefined;

    beforeEach(async () => {
      world = await lockWorld(dialect, { fresh: true });
      adapter = await world.connect();
      migrationsDir = mkdtempSync(join(tmpdir(), "nextly-cleanup-lock-"));
      // The core reconcile builds every system table the cleanup reads and writes.
      await migrateCore({
        extensionSchema: undefined,
        dialect,
        db: adapter.getDrizzle(),
        adapter: adapter as never,
        migrationsDir,
        logger,
        lockMode: "wait",
        lockWaitMs: 1_000,
        ensureLedger: () => ensureSchemaEventsTable(adapter),
      });
      const seeded = await new PermissionSeedService(
        adapter,
        serviceLogger
      ).seedCollectionPermissions(GHOST);
      expect(seeded.created).toBeGreaterThan(0);
    }, 60_000);

    afterEach(async () => {
      if (holder !== undefined) {
        holder.kill("SIGKILL");
        await holder.exited;
        holder = undefined;
      }
      await adapter.disconnect();
      rmSync(migrationsDir, { recursive: true, force: true });
      await world.dispose();
    }, 60_000);

    async function ghostPermissions(): Promise<string[]> {
      const rows = (await adapter.executeQuery(
        `SELECT id FROM permissions WHERE resource = '${GHOST}'`
      )) as Array<{ id: string }>;
      return rows.map(row => String(row.id)).sort();
    }

    /** What a refused cleanup must leave alone: every table, every permission and every grant. */
    async function databaseState(): Promise<{
      tables: string[];
      permissions: string[];
      grants: number;
    }> {
      const tables = (await adapter.listTables())
        .filter(name => name !== "nextly_schema_lock")
        .sort();
      const permissions = (
        (await adapter.executeQuery("SELECT id FROM permissions")) as Array<{
          id: string;
        }>
      )
        .map(row => String(row.id))
        .sort();
      const grants = Number(
        (
          (await adapter.executeQuery(
            "SELECT COUNT(*) AS n FROM role_permissions"
          )) as Array<{ n: unknown }>
        )[0]?.n ?? 0
      );
      return { tables, permissions, grants };
    }

    /** The lock tables this database has, the earlier ones included. */
    async function lockTables(): Promise<string[]> {
      return (await adapter.listTables())
        .filter(name => LOCK_TABLES.includes(name))
        .sort();
    }

    async function holdTheLock(): Promise<void> {
      holder = startHolder(world, {
        command: "nextly db:sync",
        leaseSeconds: 30,
        prefix: "pclk_holder",
      });
      await holder.printed("held");
    }

    function cleanup(lockWaitMs: number) {
      return cleanupOrphanedPermissionsUnderLock({
        adapter,
        logger: serviceLogger,
        lockWaitMs,
      });
    }

    it("deletes the permissions of a collection the registry does not hold, with the lock free", async () => {
      expect(await ghostPermissions()).not.toEqual([]);
      const result = await cleanup(1_000);
      expect(result.created).toBeGreaterThan(0);
      expect(await ghostPermissions()).toEqual([]);
    }, 90_000);

    it("is refused while another process holds the lock, changing nothing", async () => {
      await holdTheLock();
      // The holder's own first table is part of the state from here on.
      const before = await databaseState();
      expect(before.permissions).toEqual(
        expect.arrayContaining(await ghostPermissions())
      );
      const error = await cleanup(1_000).then(
        () => undefined,
        (e: unknown) => e
      );
      expect(NextlyError.is(error) ? error.code : error).toBe(
        "NEXTLY_MIGRATE_LOCK_BUSY"
      );
      expect(await databaseState()).toEqual(before);
    }, 90_000);

    it("is refused while a field-group storage migration has stalled, as db:sync is, changing nothing", async () => {
      // A migration that renamed some of its tables and stopped: mid-way, the registry's slugs can
      // name storage neither layout matches, so the orphans cannot be judged.
      const entries = [
        { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ];
      await beginMigration(new MetaService(adapter, logger), {
        direction: "up",
        migrationId: "pcl-stalled",
        plan: { registryHash: "pcl", manifestHash: hashManifest(entries) },
        appliedManifest: entries,
      });
      const before = await databaseState();
      expect(before.permissions).toEqual(
        expect.arrayContaining(await ghostPermissions())
      );
      const error = await cleanup(1_000).then(
        () => undefined,
        (e: unknown) => e
      );
      expect(NextlyError.is(error) ? error.code : error).toBe(
        "SERVICE_UNAVAILABLE"
      );
      expect(toCliError(error).code).toBe("FIELD_GROUP_MIGRATION_IN_FLIGHT");
      expect(await databaseState()).toEqual(before);
    }, 90_000);

    it("names a stalled field-group storage migration in a dry run as the real run's refusal, listing nothing", async () => {
      const entries = [
        { kind: "table" as const, from: "comp_hero", to: "fg_hero" },
        {
          kind: "registry" as const,
          from: "dynamic_components",
          to: "dynamic_field_groups",
        },
      ];
      await beginMigration(new MetaService(adapter, logger), {
        direction: "up",
        migrationId: "pcl-dry-stalled",
        plan: { registryHash: "pcl", manifestHash: hashManifest(entries) },
        appliedManifest: entries,
      });
      const before = await databaseState();
      expect(await ghostPermissions()).not.toEqual([]);
      const lines: string[] = [];
      const printing = createLogger({ quiet: true });
      printing.info = (message: string) => void lines.push(message);

      await runPermissionsCleanup(adapter, printing, { dryRun: true });

      expect(lines).toContain(
        "A real run would refuse: The command did not run: a field-group storage migration is in flight on this database."
      );
      expect(lines.filter(line => line.startsWith("Would "))).toEqual([]);
      expect(lines.at(-1)).toBe("Dry run: nothing was changed.");
      expect(await databaseState()).toEqual(before);
    }, 90_000);

    it("reads the registry once it holds the lock, keeping a collection registered while it waited", async () => {
      await holdTheLock();
      const ghost = await ghostPermissions();
      const run = cleanup(20_000);
      await sleep(1_500);
      // While it waits, another run registers the collection those permissions belong to.
      await new CollectionRegistryService(
        adapter,
        serviceLogger
      ).registerCollection({
        slug: GHOST,
        labels: { singular: "Ghost", plural: "Ghosts" },
        tableName: `dc_${GHOST}`,
        fields: [],
        source: "ui",
        schemaHash: "pclk",
        configPath: "pclk",
      });
      holder?.send("release");

      await run;
      expect(await ghostPermissions()).toEqual(ghost);
    }, 90_000);

    it("creates no lock table on a database that has none, and still deletes", async () => {
      // An installation from before the schema lock: every system table, no lock table.
      await world.reset(adapter);
      expect(await lockTables()).toEqual([]);
      expect(await ghostPermissions()).not.toEqual([]);

      const result = await cleanup(1_000);

      expect(result.created).toBeGreaterThan(0);
      expect(await ghostPermissions()).toEqual([]);
      // The cleanup deletes rows and issues no DDL, so a role without DDL rights can run it.
      expect(await lockTables()).toEqual([]);
    }, 90_000);
  }
);
