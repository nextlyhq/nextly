/**
 * The collection registry `db:sync --promote` and `--demote` change, on the environment's
 * database, and how each of them writes it. One place for both, so each ends a missing database or
 * a failed connection with the same error, holds the schema lock the same way, and refuses a record
 * that moved after the operator confirmed with the same error.
 *
 * @module cli/commands/db-sync-registry
 */

import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { withMigrationExcluded } from "../../domains/field-groups/migration/sync-guard";
import { planChangedAfterConsent } from "../../domains/schema/migrate/plan-changed-after-consent";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import type { NextlyError } from "../../errors/nextly-error";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import {
  connectOrExit,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import type { Logger } from "../utils/logger";

/** The registry a promote or demote changes, and the adapter it was opened on. */
export interface CollectionRegistryHandle {
  registry: CollectionRegistryService;
  /** The connection the registry reads and writes on, and the one the schema lock is taken on. */
  adapter: DrizzleAdapter;
}

export async function openCollectionRegistry(
  logger: Logger
): Promise<CollectionRegistryHandle> {
  const env = requireDatabaseEnv(logger);
  const connected = await connectOrExit(
    { dialect: env.dialect, databaseUrl: env.databaseUrl, logger },
    logger
  );
  // The service expects a full DrizzleAdapter; the CLI adapter is structurally compatible.
  const adapter = connected as unknown as DrizzleAdapter;
  return { registry: collectionRegistryOn(adapter, logger), adapter };
}

/**
 * The registry service on `adapter`. Its progress is debug output here; the logger's methods are
 * closures, so they pass as they are.
 */
export function collectionRegistryOn(
  adapter: DrizzleAdapter,
  logger: Logger
): CollectionRegistryService {
  return new CollectionRegistryService(adapter, {
    info: logger.debug,
    warn: logger.warn,
    error: logger.error,
    debug: logger.debug,
  });
}

/**
 * Run a promote's or demote's registry write holding the schema lock, the way `db:sync` and a
 * Schema Builder save hold it.
 *
 * - A held lock is waited for, about a minute, and then the command stops naming the holder.
 * - A field-group storage migration in flight refuses it with the error `db:sync` gives, because
 *   mid-run the registry describes storage neither configuration does.
 * - The lock table is never created: these write a registry row and issue no DDL, so a role with
 *   DML but no DDL rights keeps the command it had.
 * - An interrupt does not hand the claim away while the write is still running: the snippet append
 *   and the registry write are not atomic, and a migration taking the row in between is the
 *   overlap the lock exists to prevent.
 */
export async function withCollectionRegistryWrite<T>(
  args: {
    adapter: DrizzleAdapter;
    logger: Logger;
    /** The command, as the operator typed it; named in the refusal another run prints. */
    label: string;
    /** How long a held lock is waited for, in milliseconds. */
    waitMs?: number;
  },
  work: () => Promise<T>
): Promise<T> {
  return withMigrationExcluded(
    {
      adapter: args.adapter,
      logger: args.logger,
      label: args.label,
      whenHeld: "wait",
      mayCreateLock: false,
      releaseOnInterrupt: false,
      ...(args.waitMs !== undefined ? { waitMs: args.waitMs } : {}),
    },
    work
  );
}

/**
 * Whether the record read under the lock is the record the operator confirmed.
 *
 * Compared whole, because every column of the row is what the confirmed write acts on: a promote
 * deletes the row the preview came from, a demote replaces the one it found. Absence is a state of
 * its own, so a record that appeared or vanished since the preview is a change too.
 */
export function sameCollectionRecord(
  confirmed: DynamicCollectionRecord | null,
  current: DynamicCollectionRecord | null
): boolean {
  if (confirmed === null || current === null) return confirmed === current;
  return JSON.stringify(confirmed) === JSON.stringify(current);
}

/** A record as the operator was shown it: the collection's code, or nothing when it is absent. */
function shownAs(
  slug: string,
  record: DynamicCollectionRecord | null
): string[] {
  if (record === null) return [];
  const fields = (record.fields ?? []) as unknown[];
  return [serializeCollection({ slug, fields: fields as never[] })];
}

/**
 * The refusal of a promote or demote whose collection record changed, appeared or vanished between
 * the operator's confirmation and the write, raised before anything was written. The CLI ends it
 * as `PLAN_CHANGED_AFTER_CONSENT`.
 */
export function collectionChangedAfterConsent(args: {
  slug: string;
  /** The command as the operator types it. */
  command: string;
  confirmed: DynamicCollectionRecord | null;
  current: DynamicCollectionRecord | null;
}): NextlyError {
  return planChangedAfterConsent({
    command: args.command,
    message: `${args.slug} changed after you confirmed; nothing was changed; run the command again`,
    agreed: shownAs(args.slug, args.confirmed),
    current: shownAs(args.slug, args.current),
  });
}
