/**
 * Retiring the collections, Singles and field groups an applied migration dropped, as `nextly
 * migrate` does once the registry pass that found them has committed
 * (`RegistryWriteResult.retiring`): it removes in this database what the entity's delete removed
 * in development, through the same removal (`remove-entity-owned-data.ts`).
 *
 * The migration file dropped the entity's tables; this removes what it owned outside them. First
 * the rows its delete removes before its tables go (its field-group values and its translation
 * rows), each kind in a transaction of its own, then its registry row with what goes with it
 * (autosaves, version pins, "seen" markers, dashboard pins, media usage), last. While the registry
 * row stands the entity is still owed, and every run finds it the same way, from the migrations
 * recorded applied, so a run stopped part-way is finished by the next, with nothing pending and no
 * drop run again. Each step removes only what is still there.
 *
 * @module domains/schema/migrate/retire-dropped-entities
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import {
  assertSchemaLockHeld,
  isSchemaLockLost,
} from "../pipeline/schema-lock";
import {
  removeOwnedRows,
  rowsRemovedBeforeTheDrop,
  type OwningEntity,
} from "../services/remove-entity-owned-data";

import { ownedRowsAdapterIn } from "./owned-rows-adapter";
import { removeRegistryRowsIn } from "./registry-writer";
import { reachStopPoint } from "./stop-points";

/** What a retirement did: the registry rows removed, and what each entity it stopped on still owes. */
export interface RetiredEntities {
  /** Entities retired whole, as `<kind> <slug>`. */
  removed: string[];
  /** Entities not retired whole, as `<kind> <slug>` and the kinds of row they still hold. */
  owed: string[];
}

/** Where a retirement reports what stopped it. */
export interface RetirementLogger {
  warn(message: string): void;
}

/** Retires each of `entities` in turn. One that stops part-way is reported owed; the rest go on. */
export async function retireDroppedEntities(
  adapter: DrizzleAdapter,
  entities: readonly OwningEntity[],
  logger: RetirementLogger
): Promise<RetiredEntities> {
  const retired: RetiredEntities = { removed: [], owed: [] };
  for (const entity of entities) {
    const name = `${entity.kind} ${entity.slug}`;
    const stopped = await removeRowsInSteps(adapter, entity);
    if (stopped !== undefined) {
      owe(
        retired,
        logger,
        name,
        [...stopped.left, "registry row"],
        stopped.error
      );
      continue;
    }
    try {
      await assertSchemaLockHeld();
      retired.removed.push(...(await removeRegistryRowsIn(adapter, [entity])));
    } catch (error) {
      if (isSchemaLockLost(error)) throw error;
      owe(retired, logger, name, ["registry row"], error);
      continue;
    }
    // Retired whole: a stop here leaves nothing owed, so the point is outside the report above.
    await reachStopPoint(`${name}: removed registryRow`);
  }
  return retired;
}

/**
 * Removes `entity`'s rows of each kind its delete removes before its tables go, each in a
 * transaction of its own. Undefined once every kind is removed; otherwise the kinds left, from the
 * one that failed, and its error. A lost schema lock ends the run: it is never one entity's to
 * report and go on from.
 */
async function removeRowsInSteps(
  adapter: DrizzleAdapter,
  entity: OwningEntity
): Promise<{ left: string[]; error: unknown } | undefined> {
  const kinds = rowsRemovedBeforeTheDrop(entity.kind);
  for (const [index, data] of kinds.entries()) {
    try {
      await assertSchemaLockHeld();
      await adapter.transaction(tx =>
        removeOwnedRows(ownedRowsAdapterIn(adapter, tx), entity, data)
      );
    } catch (error) {
      if (isSchemaLockLost(error)) throw error;
      return { left: kinds.slice(index), error };
    }
    try {
      await reachStopPoint(`${entity.kind} ${entity.slug}: removed ${data}`);
    } catch (error) {
      return { left: kinds.slice(index + 1), error };
    }
  }
  return undefined;
}

/** Records that `name` still holds `left`, and says why. */
function owe(
  retired: RetiredEntities,
  logger: RetirementLogger,
  name: string,
  left: readonly string[],
  error: unknown
): void {
  retired.owed.push(`${name} (${left.join(", ")})`);
  logger.warn(
    `Could not finish removing what ${name} owned: ${
      error instanceof Error ? error.message : String(error)
    }. It still holds: ${left.join(", ")}.`
  );
}
