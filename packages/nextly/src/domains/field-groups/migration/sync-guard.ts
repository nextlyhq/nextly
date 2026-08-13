/**
 * Keeps schema sync away from storage a migration is halfway through renaming.
 *
 * `db:sync` reconciles the database against the config and, with
 * `--remove-orphaned`, deletes entities the config no longer declares. Mid-run
 * that reconciliation is reading a world neither the old config nor the new one
 * describes: some tables carry their pre-rename names and some their post-rename
 * names, and the registry rows pointing at them move one step at a time.
 *
 * Nothing about that is recoverable by being careful in the sync. The only safe
 * answer is not to run, so this refuses and says how to clear the state.
 *
 * @module domains/field-groups/migration/sync-guard
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../../../errors/nextly-error";
import type { Logger } from "../../../shared/types";
import { MetaService } from "../../meta/services/meta-service";

import { withMigrationSession } from "./session";
import { readMigrationState } from "./state";

/** The key/value table the migration marker lives in. */
const META_TABLE = "nextly_meta";

/**
 * Refuse to continue while a field-group storage migration is in flight.
 *
 * Call after the core tables exist — the marker lives in `nextly_meta`, so a
 * database that has never been set up has nothing to read — and before anything
 * that inspects or changes schema.
 *
 * A marker that is present but unreadable refuses through `readMigrationState`
 * rather than being treated as absent, which is the same call this makes at
 * runtime: an unreadable marker may still describe renamed objects.
 */
export async function assertNoMigrationInFlight(args: {
  adapter: DrizzleAdapter;
  logger: Logger;
  /**
   * What is being refused, in the operator's terms.
   *
   * Named by the caller rather than fixed here, because the two callers are
   * refusing different things and the message is the only thing that tells an
   * operator which. Someone whose Schema Builder edit was declined should not
   * be told a schema sync was.
   */
  action: string;
}): Promise<void> {
  // A database that has no `nextly_meta` at all has never recorded a marker, so
  // there is no run to be in flight. Asked explicitly rather than inferred from
  // a failed read: an unreadable marker must still refuse, and asked explicitly
  // rather than inferred from core-table setup either, because that returns as
  // soon as it finds `users` and so does not establish the newer system tables
  // on a database that predates them.
  if (!(await args.adapter.tableExists(META_TABLE))) return;

  const state = await readMigrationState(
    new MetaService(args.adapter, args.logger)
  );
  if (state.status !== "migrating") return;

  throw NextlyError.serviceUnavailable({
    logMessage: `${args.action} refused: a field group storage migration is in flight`,
    logContext: {
      reason: "field group storage migration is in flight",
      direction: state.direction,
      migrationId: state.migrationId,
      step: state.step,
    },
  });
}

/**
 * Run schema sync work with a storage migration excluded for its whole duration.
 *
 * Reading the marker and then proceeding only answers whether a migration had
 * started by the instant of the read. A sync takes far longer than that, and a
 * migration beginning immediately afterwards renames tables underneath work that
 * has already decided what exists — with `--remove-orphaned`, deciding to delete
 * it. Exclusion has to be *held*, not sampled.
 *
 * The migration's own lock is what it is held with, so the two exclude each
 * other through one mechanism rather than two that must agree. A run in flight
 * holds it and this refuses; a run that died holds it still, by design, because
 * there is no trustworthy clock to expire it with.
 *
 * The marker is then checked inside the lock, because holding it is necessary
 * and not sufficient: an operator who cleared a dead run's lock row without
 * settling its marker would otherwise be let straight through into exactly the
 * half-renamed storage this exists to protect.
 */
export async function withMigrationExcluded<T>(
  args: {
    adapter: DrizzleAdapter;
    logger: Logger;
    label: string;
    /**
     * Whether this caller is allowed to issue schema changes.
     *
     * When it is, the lock table is created if missing, so the exclusion is
     * real even on a database no migration has touched yet — otherwise a first
     * migration could create the table and claim it while a sync was already
     * running unprotected.
     *
     * When it is not (`--no-auto-sync`, or a role with DML but no DDL), the
     * table cannot be created, and a database without one has never run a
     * migration. The residual is a first-ever migration starting during that
     * sync, which is narrower than refusing the command outright.
     */
    mayCreateLock: boolean;
    /**
     * Whether an interrupt may hand the claim away while `work` is still running.
     *
     * Stated by every caller rather than defaulted, because the two answers protect different
     * things and the safe one depends on what the work does, which this cannot see.
     *
     * A schema SYNC opts in: the documented way to stop watch mode is Ctrl+C, its work is
     * idempotent, and two syncs overlapping is the state that existed before this exclusion, so a
     * claim stuck behind a dead process is the worse outcome.
     *
     * A schema CHANGE must not. Its DDL and its registry write are neither atomic nor idempotent,
     * and the signal does not stop `work` — another listener delaying termination is enough for a
     * migration to take the row and start renaming while the change is still finishing. That is
     * precisely the overlap the exclusion exists to prevent, so the claim is held to the end and a
     * killed process leaves a claim for an operator, which is the trade a migration already makes.
     */
    releaseOnInterrupt: boolean;
  },
  work: () => Promise<T>
): Promise<T> {
  return withMigrationSession(
    {
      adapter: args.adapter,
      dialect: args.adapter.getCapabilities().dialect,
      label: args.label,
      requireExistingLock: !args.mayCreateLock,
      releaseOnInterrupt: args.releaseOnInterrupt,
    },
    async () => {
      await assertNoMigrationInFlight({
        action: args.label,
        adapter: args.adapter,
        logger: args.logger,
      });
      return work();
    }
  );
}
