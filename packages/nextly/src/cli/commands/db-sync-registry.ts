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
import { SCHEMA_LOCK_TABLE } from "../../domains/schema/pipeline/schema-lock";
import { serializeCollection } from "../../domains/schema/services/code-generator";
import { NextlyError } from "../../errors/nextly-error";
import type { DynamicCollectionRecord } from "../../schemas/dynamic-collections/types";
import { CollectionRegistryService } from "../../services/collections/collection-registry-service";
import { CliError } from "../errors/cli-error";
import { toCliError } from "../errors/from-thrown";
import {
  openOrConnect,
  requireDatabaseEnv,
} from "../utils/command-prerequisites";
import type { Logger } from "../utils/logger";

/** The registry a promote or demote changes, and the adapter it was opened on. */
export interface CollectionRegistryHandle {
  registry: CollectionRegistryService;
  /** The connection the registry reads and writes on, and the one the schema lock is taken on. */
  adapter: DrizzleAdapter;
}

/**
 * The registry on the environment's database: connected for a real run, opened read-only for a
 * dry run. Undefined only for a dry run whose database is not there, which has been said and ends
 * the command.
 */
export async function openCollectionRegistry(
  logger: Logger,
  dryRun = false
): Promise<CollectionRegistryHandle | undefined> {
  const env = requireDatabaseEnv(logger);
  const connected = await openOrConnect(
    { dialect: env.dialect, databaseUrl: env.databaseUrl, logger },
    dryRun,
    logger
  );
  if (connected === undefined) return undefined;
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
 * - The lock table is made only where it is missing (`registryWriteLocked`), so a role with DML
 *   but no DDL rights keeps the command it had on every database a run of this version has made
 *   the table on.
 * - An interrupt does not hand the claim away while the write is still running: the snippet append
 *   and the registry write are not atomic, and a migration taking the row in between is the
 *   overlap the lock exists to prevent.
 */
export async function withCollectionRegistryWrite<T>(
  args: RegistryWriteArgs,
  work: () => Promise<T>
): Promise<T> {
  if (await args.adapter.tableExists(SCHEMA_LOCK_TABLE)) {
    return registryWriteLocked(args, false, work);
  }
  return registryWriteMakingTheLock(args, work);
}

/** How a promote's or demote's registry write holds the lock. */
interface RegistryWriteArgs {
  adapter: DrizzleAdapter;
  logger: Logger;
  /** The command, as the operator typed it; named in the refusal another run prints. */
  label: string;
  /** How long a held lock is waited for, in milliseconds. */
  waitMs?: number;
}

/**
 * The registry write on a database with no schema lock table, which no run of this version has
 * made. A run that may not make it holds no lock row there, so a development start or a sync
 * started beside the write, which makes the table and takes the row, would interleave with it:
 * the write makes the table first, as those runs do, and then holds the row.
 *
 * Where the table still could not be made, before any of the work ran, the role may not create
 * tables: the write goes on as before, holding the earlier locks only, and says so once.
 */
async function registryWriteMakingTheLock<T>(
  args: RegistryWriteArgs,
  work: () => Promise<T>
): Promise<T> {
  let started = false;
  try {
    return await registryWriteLocked(args, true, () => {
      started = true;
      return work();
    });
  } catch (error) {
    if (started || (await args.adapter.tableExists(SCHEMA_LOCK_TABLE))) {
      throw error;
    }
    args.logger.warn(
      `The schema lock's table (${SCHEMA_LOCK_TABLE}) could not be created, so ${args.label} runs without it, as before: a development start, a sync or a migration run at the same time is not held off. Run \`nextly migrate\`, \`nextly db:sync\` or a development start once with a role that can create tables to make it.`
    );
    return registryWriteLocked(args, false, work);
  }
}

/** The write holding the schema lock, making its table where `mayCreateLock` allows. */
function registryWriteLocked<T>(
  args: RegistryWriteArgs,
  mayCreateLock: boolean,
  work: () => Promise<T>
): Promise<T> {
  return withMigrationExcluded(
    {
      adapter: args.adapter,
      logger: args.logger,
      label: args.label,
      whenHeld: "wait",
      mayCreateLock,
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

/** The registry's refusals a dry run names, by their code: each says what was refused. */
const REFUSAL_CODES = new Set([
  "FORBIDDEN",
  "DUPLICATE",
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "CONFLICT",
]);

/**
 * What a real `db:sync` would print for `error` as its refusal, for a dry run to name, or
 * undefined when `error` is no refusal but a failure, which the dry run ends on as the real run
 * would. A command's own refusal says what it refused; one the CLI maps, such as a field-group
 * storage migration in flight, is worded as the CLI words it; the registry's refusals by their
 * public message.
 */
export function syncRefusalOf(error: unknown): string | undefined {
  if (error instanceof CliError) return error.what;
  if (!NextlyError.is(error)) return undefined;
  const mapped = toCliError(error);
  if (mapped.code !== "UNEXPECTED_ERROR") return mapped.what;
  return REFUSAL_CODES.has(error.code) ? error.publicMessage : undefined;
}
