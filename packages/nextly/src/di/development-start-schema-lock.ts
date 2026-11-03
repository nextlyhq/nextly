/**
 * The schema lock as a development start takes it around its schema sync.
 *
 * The start reconciles plugin fields onto Builder entities and syncs the code-first collections,
 * field groups and Singles: both write registry rows and change storage. A `nextly migrate`, a
 * `db:sync` or a Builder save in another process changes the same rows and tables, so the start
 * holds the one schema lock every schema change holds, for the whole of both steps.
 *
 * @module di/development-start-schema-lock
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";

import { NextlyError } from "../errors/nextly-error";
import type { Logger } from "../shared/types";

/** What the claim names while a development start holds the lock. */
export const DEVELOPMENT_START_SYNC_COMMAND = "development start: schema sync";

/**
 * Run the start's schema sync holding the schema lock, outside production.
 *
 * A held lock is waited for, as a command-line run waits (about a minute, then the start stops
 * naming the holder), rather than refused: a start that skipped its sync would serve a schema it
 * never reconciled. Work already inside a holder's context, such as the boot a plugin install
 * makes while it holds the lock, runs in that holder's claim.
 *
 * Production takes no lock here. Its schema reaches the database through migrations, and the boot
 * migrations hold the lock on their own path (`init/prod-migrations`).
 */
export async function withDevelopmentStartSchemaLock<T>(
  adapter: DrizzleAdapter,
  logger: Logger,
  work: () => Promise<T>
): Promise<T> {
  if (process.env.NODE_ENV === "production") return work();

  // Loaded on demand, as the other boot paths load it, so the lock machinery stays out of the
  // module graph of a production boot.
  const { withSchemaLock } = await import(
    "../domains/schema/pipeline/schema-lock"
  );
  const outcome = await withSchemaLock(
    {
      adapter,
      command: DEVELOPMENT_START_SYNC_COMMAND,
      whenHeld: "wait",
      // As the development reload takes it: the sync creates and alters tables by design, so it
      // may establish the lock tables rather than run unprotected on a database without them.
      mayCreateTables: true,
      // As the development reload and `db:sync` take it. Outside production this runs under
      // `next dev` or a command, where Ctrl+C is how the process is stopped, and a claim stranded
      // behind a stopped process would hold every later start and reload for a whole lease. The
      // sync only creates what is missing, adds what is new and rewrites registry rows to match
      // the config, so a start interrupted part way is completed by the next one. A first start's
      // core setup (`firstStartSchemaLock`) keeps its claim on an interrupt instead, because it
      // also runs in production, where a signal may begin a graceful shutdown.
      releaseOnInterrupt: true,
      logger: {
        warn: message => logger.warn(message),
        info: message => logger.info(message),
      },
    },
    work
  );
  // `ran: false` is only ever a wait that `isSettled` ended, and none is passed here.
  if (!outcome.ran) {
    throw NextlyError.internal({
      logContext: {
        reason: "development start schema lock settled without work",
      },
    });
  }
  return outcome.value;
}
