/**
 * A run that can no longer show it holds the schema lock starts no further statement, on
 * PostgreSQL, MySQL and SQLite: once another run took the lock from it, and once it could no
 * longer confirm its hold within the lease. The statement it would have sent next never reaches
 * the database, and the run stops saying it lost the lock.
 */
import { randomBytes } from "node:crypto";

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { SchemaEventsRepository } from "../../events/schema-events-repository";
import { runMigrationStatements } from "../../migrate/migration-transaction";
import { DrizzleStatementExecutor } from "../../services/drizzle-statement-executor";
import { withSchemaLock } from "../schema-lock";

import {
  LOCK_DIALECTS,
  lockWorld,
  sleep,
  tablesWithPrefix,
  type LockWorld,
} from "./helpers/schema-lock-world";

const PREFIX = `sll_${randomBytes(4).toString("hex")}`;
const ASIDE = `${PREFIX}_aside`;
const TABLES = [`${PREFIX}_first`, `${PREFIX}_second`, ASIDE];

const quiet = { warn: () => {}, info: () => {} };

/** Long enough past a 2 s lease for a renewal to have answered, and for confirmation to lapse. */
const PAST_THE_LEASE_MS = 2_500;

describe.each(LOCK_DIALECTS)(
  "a run that lost the schema lock on %s",
  dialect => {
    let world: LockWorld;
    let adapter: DrizzleAdapter;

    beforeEach(async () => {
      world = await lockWorld(dialect);
      adapter = await world.connect();
      await world.reset(adapter, TABLES);
    });

    afterEach(async () => {
      await world.reset(adapter, TABLES);
      await adapter.disconnect();
      await world.dispose();
    });

    /** One file's statement, run as `nextly migrate` runs it. */
    const statement = (table: string) =>
      runMigrationStatements(adapter, [`CREATE TABLE ${table} (id integer)`], {
        source: `${table}.sql`,
        transaction: true,
      });

    /** A run holding the lock on a 2 s lease, which `between` takes from it after its first file. */
    const run = (between: () => Promise<void>) =>
      withSchemaLock(
        {
          adapter,
          command: "nextly migrate",
          whenHeld: "refuse",
          leaseSeconds: 2,
          logger: quiet,
        },
        async () => {
          await statement(`${PREFIX}_first`);
          await between();
          await sleep(PAST_THE_LEASE_MS);
          await statement(`${PREFIX}_second`);
        }
      );

    it("starts no further statement once another run took the lock", async () => {
      await expect(
        run(() =>
          adapter
            .executeQuery(
              "UPDATE nextly_schema_lock SET owner = 'another run' WHERE id = 1"
            )
            .then(() => undefined)
        )
      ).rejects.toMatchObject({
        logContext: { reason: "schema lock lost while held" },
      });

      expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([
        `${PREFIX}_first`,
      ]);
    });

    it("starts no further statement once it can no longer confirm its hold", async () => {
      // Every renewal now fails: the run can neither extend nor read its lease.
      await expect(
        run(() =>
          adapter
            .executeQuery(`ALTER TABLE nextly_schema_lock RENAME TO ${ASIDE}`)
            .then(() => undefined)
        )
      ).rejects.toMatchObject({
        logContext: { reason: "schema lock lost while held" },
      });

      expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([
        `${PREFIX}_aside`,
        `${PREFIX}_first`,
      ]);
    });

    it("starts no further statement of a push once another run took the lock", async () => {
      // `db:sync` and the development push send their statements through this executor.
      let refused: unknown;
      await withSchemaLock(
        {
          adapter,
          command: "nextly db:sync",
          whenHeld: "refuse",
          leaseSeconds: 2,
          logger: quiet,
        },
        async () => {
          await adapter.executeQuery(
            "UPDATE nextly_schema_lock SET owner = 'another run' WHERE id = 1"
          );
          await sleep(PAST_THE_LEASE_MS);
          const db = adapter.getDrizzle();
          refused = await new DrizzleStatementExecutor(dialect, db)
            .executeStatements(db, [
              `CREATE TABLE ${PREFIX}_second (id integer)`,
            ])
            .catch((error: unknown) => error);
        }
      ).catch(() => undefined);

      expect(refused).toMatchObject({
        logContext: { reason: "schema lock lost while held" },
      });
      expect(await tablesWithPrefix(adapter, PREFIX)).toEqual([]);
    });

    it("records nothing further in the ledger once another run took the lock", async () => {
      const ledger = new SchemaEventsRepository(adapter.getDrizzle(), dialect);
      let refused: unknown;
      await withSchemaLock(
        {
          adapter,
          command: "nextly migrate",
          whenHeld: "refuse",
          leaseSeconds: 2,
          logger: quiet,
        },
        async () => {
          await adapter.executeQuery(
            "UPDATE nextly_schema_lock SET owner = 'another run' WHERE id = 1"
          );
          await sleep(PAST_THE_LEASE_MS);
          // Refused before it reaches the database, whose ledger this test never created.
          refused = await ledger
            .insertEvent({ eventType: "file_apply", status: "applied" })
            .catch((error: unknown) => error);
        }
      ).catch(() => undefined);

      expect(refused).toMatchObject({
        logContext: { reason: "schema lock lost while held" },
      });
    });
  }
);
