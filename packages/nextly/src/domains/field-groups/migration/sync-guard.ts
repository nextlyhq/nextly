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
}): Promise<void> {
  const state = await readMigrationState(
    new MetaService(args.adapter, args.logger)
  );
  if (state.status !== "migrating") return;

  throw NextlyError.serviceUnavailable({
    logMessage:
      "schema sync refused: a field group storage migration is in flight",
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
  args: { adapter: DrizzleAdapter; logger: Logger; label: string },
  work: () => Promise<T>
): Promise<T> {
  return withMigrationSession(
    {
      adapter: args.adapter,
      dialect: args.adapter.getCapabilities().dialect,
      label: args.label,
    },
    async () => {
      await assertNoMigrationInFlight({
        adapter: args.adapter,
        logger: args.logger,
      });
      return work();
    }
  );
}
