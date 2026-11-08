/**
 * Expires the cached reads a content change makes stale, through whichever
 * revalidator the app registered.
 *
 * For the writes that change what reads return without going through an entry
 * or Single service: deleting a collection or a Single, or a plugin writing to
 * columns it added to one. And for the changes that write no content at all
 * yet change what every read may return: the site's languages, and what a
 * role grants. Each passes the intent its builder made, which is
 * `undefined` when the collection or Single opts out of revalidation, so an
 * opted-out one is skipped here exactly as on every other write.
 *
 * @module domains/flush-content-change
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../errors/nextly-error";
import {
  buildCollectionRevalidationIntent,
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../revalidation/intent-builders";
import type {
  CacheRevalidator,
  FlushOutcome,
  RevalidationIntent,
} from "../revalidation/types";

import type { LanguageChangeContentCache } from "./i18n/services/language-settings-service";
import type { JobsRepository } from "./jobs/jobs-repository";

/** Where a failed flush is reported. */
interface FlushLogger {
  error?: (message: string, context?: Record<string, unknown>) => void;
}

/**
 * Flushes `intent` to the registered revalidator. Best-effort: the change is
 * already committed, so a failure is logged, never thrown. Nothing to flush,
 * or no revalidator registered (the CLI, a script), is a no-op.
 */
export async function flushContentChange(
  intent: RevalidationIntent | undefined,
  logger: FlushLogger | undefined,
  what: string
): Promise<void> {
  if (!intent || intent.tags.length === 0) return;
  // Loaded here rather than at the top: the metadata services that call this
  // are imported by CLI paths that never reach the service registry, and a
  // static import would make every one of them load it.
  const { container } = await import("../di/container");
  if (!container.has("cacheRevalidator")) return;
  try {
    await container.get<CacheRevalidator>("cacheRevalidator").flush([intent]);
  } catch (error) {
    logger?.error?.(`Cache revalidation failed after ${what}`, { error });
  }
}

/**
 * The intent that expires the cached reads of a collection or Single being
 * deleted, from the `revalidate` value its registry row stores: a JSON string
 * on SQLite and the raw-insert path, an object on PostgreSQL and MySQL.
 * `undefined` when it opts out. Read from the row the delete removes, inside
 * its transaction, so the setting is the current one rather than a cached copy.
 */
export function deletedEntityIntent(
  kind: "collection" | "single",
  slug: string,
  stored: unknown
): RevalidationIntent | undefined {
  const revalidate = readRevalidateConfig({ revalidate: parsed(stored) });
  return kind === "collection"
    ? buildCollectionRevalidationIntent(slug, revalidate)
    : buildSingleRevalidationIntent(slug, revalidate);
}

/** A stored JSON value, parsed; one that does not parse reads as unset. */
function parsed(stored: unknown): unknown {
  if (typeof stored !== "string") return stored;
  try {
    return JSON.parse(stored);
  } catch {
    return undefined;
  }
}

/**
 * Flushes the cache tags of every collection and Single, as one intent: the
 * tags their writes flush, the configured `revalidate.tags` included, through
 * the same intent builders, and none for one whose `revalidate.disable` opts it
 * out. Nothing where `cache` names no revalidator, so a process that caches
 * nothing reads no registry. Rejects when the registries or the flush fail;
 * each caller says what it could not refresh. Resolves what the revalidator
 * says it could not finish, for a caller that must know.
 */
export async function flushEveryContentScope(
  cache: LanguageChangeContentCache
): Promise<FlushOutcome | void> {
  const revalidator = cache.revalidator();
  if (!revalidator) return;
  const { collections, singles } = await cache.content();
  const intents = [
    ...collections.map(c =>
      buildCollectionRevalidationIntent(c.slug, readRevalidateConfig(c))
    ),
    ...singles.map(s =>
      buildSingleRevalidationIntent(s.slug, readRevalidateConfig(s))
    ),
  ];
  const tags = new Set(intents.flatMap(intent => intent?.tags ?? []));
  // A site with nothing to flush issues no revalidation, which some backends log as an error.
  if (tags.size === 0) return;
  return revalidator.flush([{ tags: [...tags] }]);
}

/**
 * {@link flushEveryContentScope}, rejecting unless every tag expired or was recorded where every
 * instance reads it. A tag the revalidator only kept in this process (the hand-off refused it, or
 * did not answer in time) is lost if the process stops, so the expiry is not done yet: the grants
 * expiry keeps its queued job, and the job is tried again, until one lands for good.
 */
export async function expireEveryContentScopeForGood(
  cache: LanguageChangeContentCache
): Promise<void> {
  const kept = (await flushEveryContentScope(cache))?.keptInProcess ?? [];
  if (kept.length > 0) {
    throw NextlyError.internal({
      logContext: {
        reason: `${kept.length} cache tags were kept in this process only, unrecorded`,
      },
    });
  }
}

/** What a failed expiry says in a log: a NextlyError's reason, else its message. */
function failureText(failure: unknown): string {
  if (failure instanceof NextlyError) {
    const reason = failure.logContext?.reason;
    if (typeof reason === "string") return reason;
  }
  return failure instanceof Error ? failure.message : String(failure);
}

/**
 * The job that expires every scope's cached reads after a change to grants. Queued before the
 * expiry is tried, so a process gone before it lands (a restart, a frozen function) leaves it
 * owed in the jobs queue, which the next jobs run performs; withdrawn once the expiry lands here.
 * Stored on each queued row, so it never changes: a row an earlier release queued must still run.
 */
export const GRANTS_CONTENT_EXPIRY_JOB = "nextly:grants-content-expiry";

/** The first wait before this process tries a failed grants expiry again, doubled after each. */
const GRANTS_EXPIRY_FIRST_RETRY_MS = 1_000;

/** The longest wait between two of this process's tries. */
const GRANTS_EXPIRY_MAX_RETRY_MS = 60_000;

/** The grants expiries this process owes and is trying again. */
interface GrantsExpiryRetry {
  timer?: ReturnType<typeof setTimeout>;
  /** The wait before the next try. */
  delayMs: number;
  /** The jobs queued for the changes whose expiry failed, withdrawn once one lands. */
  queued: Set<string>;
  /** Whether a change's expiry failed while its job could not be queued either. */
  unqueued: boolean;
  /** Moved on by each failed change, so a try can tell whether one failed while it ran. */
  failures: number;
  /** A try under way. */
  running?: Promise<void>;
  /** Set when the services it belongs to are released, so a try under way schedules no more. */
  stopped?: boolean;
}

/**
 * How far ahead a row queued before a grants write may first run. The row commits before the
 * write does, so a jobs run that took it at once could expire the pages before the change and
 * finish, leaving nothing owed if the expiry after the change then failed. Minutes, so far longer
 * than any grants write (a transaction or a seeding sweep) and than clock drift between
 * instances: by then the write has committed, or failed and the row is one spare expiry.
 */
const WRITE_AHEAD_MARGIN_MS = 5 * 60 * 1000;

/** A grants write under way, and the row queued ahead of it. */
interface GrantsWriteAhead {
  /** The row queued ahead of the writes so far and not yet taken by an expiry. */
  row?: Promise<string | undefined>;
}

// One per process, across module copies, like the expiry hand-off: a gate entered through one
// copy must be found by an expiry reached through another.
const globalForGrantsExpiry = globalThis as unknown as {
  __nextly_grants_expiry_retry?: GrantsExpiryRetry;
  __nextly_grants_write_ahead?: AsyncLocalStorage<GrantsWriteAhead>;
};

function writeAheadScope(): AsyncLocalStorage<GrantsWriteAhead> {
  globalForGrantsExpiry.__nextly_grants_write_ahead ??= new AsyncLocalStorage();
  return globalForGrantsExpiry.__nextly_grants_write_ahead;
}

/**
 * Runs `write`, a change to what some role grants, with the content expiry it owes queued as a
 * job before it starts, so the expiry is owed in the database before the change can commit: a
 * process stopped between the commit and the expiry still leaves it to the jobs queue. The
 * expiry after the change takes that row rather than queueing its own, and withdraws it once it
 * lands. Called by the gates every grants writer goes through (`writingPermissions`,
 * `inPermissionSweep`, `changingRoleGrants`); a gate inside another joins it.
 *
 * With `queue: false` (a sweep) nothing is queued until a write inside asks, so a sweep that
 * writes nothing queues nothing. A row no expiry took when the outermost gate returns is
 * withdrawn: the gate announced no change, so nothing changed. One whose write threw is left: the
 * write may have changed rows before it failed, or rolled back, and either way the row performs
 * one expiry more, which only refreshes the pages again.
 */
export async function aheadOfGrantsChange<T>(
  write: () => Promise<T>,
  options: { queue?: boolean } = {}
): Promise<T> {
  const enclosing = writeAheadScope().getStore();
  if (enclosing !== undefined) {
    if (options.queue !== false) await queueAhead(enclosing);
    return write();
  }
  const ahead: GrantsWriteAhead = {};
  if (options.queue !== false) await queueAhead(ahead);
  let threw = false;
  try {
    return await writeAheadScope().run(ahead, write);
  } catch (error) {
    threw = true;
    throw error;
  } finally {
    const left = ahead.row;
    if (left !== undefined && !threw) {
      const job = await left;
      if (job !== undefined) await withdrawGrantsExpiries([job]);
    }
  }
}

/** Queues the row ahead of a write, unless one not yet taken is queued already. */
async function queueAhead(ahead: GrantsWriteAhead): Promise<void> {
  ahead.row ??= (async () => {
    const { languageChangeContentCache } = await import(
      "../di/registrations/language-change-content-cache"
    );
    // A process that caches nothing owes no expiry, as `expireContentAfterGrantsChange` says.
    if (!languageChangeContentCache().revalidator()) return undefined;
    const { container } = await import("../di/container");
    // Where there is no jobs queue at all (a CLI path, no registered services) nothing durable
    // can be queued, and the write goes ahead with the expiry owed by this process alone.
    if (!container.has("jobsRepository")) return undefined;
    try {
      return await enqueueGrantsExpiry(
        container.get<JobsRepository>("jobsRepository"),
        new Date(Date.now() + WRITE_AHEAD_MARGIN_MS)
      );
    } catch (error) {
      // Where the queue exists but refused the row, the write is refused too: made now, it would
      // commit with nothing durable owing its expiry, which is what queueing ahead prevents.
      throw NextlyError.serviceUnavailable({
        publicMessage:
          "The change was not made, because the cache refresh it needs could not " +
          "be recorded. Try again.",
        logMessage:
          "A grants write was refused: the content expiry it owes could not be queued ahead of it",
        cause: error instanceof Error ? error : undefined,
      });
    }
  })();
  await ahead.row;
}

/** The row queued ahead of the write this flow is in, taken so no later expiry reuses it. */
function takeWriteAhead(): Promise<string | undefined> | undefined {
  const ahead = writeAheadScope().getStore();
  const row = ahead?.row;
  if (ahead !== undefined) ahead.row = undefined;
  return row;
}

function grantsExpiryRetry(): GrantsExpiryRetry {
  globalForGrantsExpiry.__nextly_grants_expiry_retry ??= {
    delayMs: GRANTS_EXPIRY_FIRST_RETRY_MS,
    queued: new Set(),
    unqueued: false,
    failures: 0,
  };
  return globalForGrantsExpiry.__nextly_grants_expiry_retry;
}

/**
 * Expires every collection's and Single's cached reads after a change to what some role grants:
 * a role's permissions, its inheritance or slug, the role deleted, or a permission row written.
 *
 * A cached public read holds what the Public role let a visitor read when it ran, and a read
 * cached for a role holds what that role let it read; a change to grants writes no content, so no
 * content write expires either. Every scope rather than the ones the change names: whichever role
 * changed may be Public, a read embeds the collections it relates to as its reader may read them,
 * and a role's inherited grants change with its parents'.
 *
 * The change has committed, so this never throws. A tag the revalidator cannot expire in the
 * request is handed off as every write's is. Reading which collections and Singles there are is
 * the part with no hand-off, and until it succeeds a cached page may keep content the change took
 * away from its reader, so the expiry is owed until it lands: queued as a job first, tried here
 * (twice), and when both tries fail, tried again by this process with a growing wait until one
 * succeeds, while the queued job covers a process that is gone first.
 *
 * The job is the one a gate queued ahead of the write (`aheadOfGrantsChange`), or, for a change
 * made outside every gate, one queued here, after the commit. A row queued ahead that is no
 * longer waiting when the expiry fails (a jobs run took it, or it was withdrawn) is replaced by a
 * fresh one, so a pending row always holds what is still owed.
 */
export async function expireContentAfterGrantsChange(): Promise<void> {
  // Loaded here rather than at the top, for the reason `flushContentChange` gives: the permission
  // writers that call this are reached from CLI paths that never load the service registry.
  const [{ languageChangeContentCache }, { getNextlyLogger }] =
    await Promise.all([
      import("../di/registrations/language-change-content-cache"),
      import("../observability/logger"),
    ]);
  const queuedAhead = takeWriteAhead();
  const wroteAhead = queuedAhead === undefined ? undefined : await queuedAhead;
  // A process that caches nothing has nothing to expire, here or later, as before.
  if (!languageChangeContentCache().revalidator()) {
    if (wroteAhead !== undefined) await withdrawGrantsExpiries([wroteAhead]);
    return;
  }
  let job = wroteAhead ?? (await queueGrantsExpiry());
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await expireEveryContentScopeForGood(languageChangeContentCache());
      if (job !== undefined) await withdrawGrantsExpiries([job]);
      return;
    } catch (error) {
      failure = error;
    }
  }
  // Still owed, so a row that waits must hold it: the one queued ahead may have been taken by a
  // jobs run that expired the pages before the change committed.
  if (wroteAhead !== undefined && !(await stillWaiting(wroteAhead))) {
    job = await queueGrantsExpiry();
  }
  const retry = grantsExpiryRetry();
  retry.failures += 1;
  if (job === undefined) retry.unqueued = true;
  else retry.queued.add(job);
  getNextlyLogger().error({
    kind: "grants-change-content-expiry-failed",
    message: `What a role grants changed, but cached pages could not be expired yet: ${failureText(
      failure
    )}. Until they are, a cached page may keep what the change took away; this process tries again${
      job === undefined
        ? ""
        : ", and the jobs queue holds it for the next jobs run"
    }.`,
  });
  scheduleGrantsExpiry(retry);
}

/**
 * Queues the expiry as a job, due from `runAt` (at once by default), and resolves its id, or
 * `undefined` where there is no jobs queue (a CLI path) or it refused the row: the expiry is then
 * owed by this process alone.
 */
async function queueGrantsExpiry(
  runAt: Date | null = null
): Promise<string | undefined> {
  const { container } = await import("../di/container");
  if (!container.has("jobsRepository")) return undefined;
  try {
    return await enqueueGrantsExpiry(
      container.get<JobsRepository>("jobsRepository"),
      runAt
    );
  } catch {
    return undefined;
  }
}

/** Queues the expiry as a job on `jobs`, due from `runAt`; rejects when the queue refuses it. */
async function enqueueGrantsExpiry(
  jobs: Pick<JobsRepository, "enqueue">,
  runAt: Date | null
): Promise<string> {
  const { id } = await jobs.enqueue({
    slug: GRANTS_CONTENT_EXPIRY_JOB,
    input: null,
    runAt,
    runAsUserId: null,
    // One row per change: a key would fold a change into a job already running, whose
    // expiry may have landed before this change committed.
    dedupeKey: null,
    now: new Date(),
  });
  return id;
}

/**
 * Whether `job` is still pending with no runner holding it. One a jobs run took (running or
 * finished) may have expired the pages before the change committed; one that cannot be asked
 * about counts as taken, so a fresh row is queued rather than none.
 */
async function stillWaiting(job: string): Promise<boolean> {
  const { container } = await import("../di/container");
  if (!container.has("jobsRepository")) return false;
  try {
    return await container
      .get<JobsRepository>("jobsRepository")
      .isUnclaimed(job);
  } catch {
    return false;
  }
}

/**
 * Removes the queued jobs of changes whose expiry has landed. One a jobs run took meanwhile is
 * left to finish, and one that could not be removed runs again: an expiry made twice only
 * refreshes the pages once more.
 */
async function withdrawGrantsExpiries(jobs: readonly string[]): Promise<void> {
  const { container } = await import("../di/container");
  if (!container.has("jobsRepository")) return;
  const repository = container.get<JobsRepository>("jobsRepository");
  await Promise.all(
    jobs.map(job => repository.withdrawUnclaimed(job).catch(() => false))
  );
}

/** Arms this process's next try, unless one is armed or under way. */
function scheduleGrantsExpiry(retry: GrantsExpiryRetry): void {
  if (retry.stopped) return;
  if (retry.timer !== undefined || retry.running !== undefined) return;
  retry.timer = setTimeout(() => {
    retry.timer = undefined;
    const run = tryGrantsExpiryAgain(retry);
    retry.running = run;
    void run.finally(() => {
      if (retry.running === run) retry.running = undefined;
      // A change that failed while this try ran is owed a try of its own.
      if (retry.failures > 0) scheduleGrantsExpiry(retry);
    });
  }, retry.delayMs);
  // The retry must not keep a process alive that has nothing else to do.
  retry.timer.unref?.();
}

/**
 * Stops this process's retries of failed grants expiries, when the services they flush through
 * are released (`clearServices`, `shutdownServices`): a later registration has its own container,
 * and an earlier one's retry must not run through it. What is owed stays owed in the jobs queue,
 * whose rows the next registration's jobs runs perform.
 */
export function stopGrantsExpiryRetry(): void {
  const retry = globalForGrantsExpiry.__nextly_grants_expiry_retry;
  if (retry === undefined) return;
  retry.stopped = true;
  if (retry.timer !== undefined) clearTimeout(retry.timer);
  retry.timer = undefined;
  globalForGrantsExpiry.__nextly_grants_expiry_retry = undefined;
}

/**
 * One more try at every owed expiry, as one: every expiry expires every scope, so one that lands
 * settles each change that failed before it began. One that failed while it ran is kept for the
 * next try, from the first wait.
 */
async function tryGrantsExpiryAgain(retry: GrantsExpiryRetry): Promise<void> {
  const [{ languageChangeContentCache }, { getNextlyLogger }] =
    await Promise.all([
      import("../di/registrations/language-change-content-cache"),
      import("../observability/logger"),
    ]);
  // Released while it waited for the imports: the services it would flush through are gone.
  if (retry.stopped) return;
  const failuresBefore = retry.failures;
  const jobs = [...retry.queued];
  try {
    await expireEveryContentScopeForGood(languageChangeContentCache());
  } catch {
    // Still owed. Queued now if it could not be before, so a restart does not lose it.
    if (retry.unqueued) {
      const job = await queueGrantsExpiry();
      if (job !== undefined) {
        retry.queued.add(job);
        retry.unqueued = false;
      }
    }
    retry.delayMs = Math.min(retry.delayMs * 2, GRANTS_EXPIRY_MAX_RETRY_MS);
    return;
  }
  for (const job of jobs) retry.queued.delete(job);
  retry.delayMs = GRANTS_EXPIRY_FIRST_RETRY_MS;
  if (retry.failures === failuresBefore) {
    retry.failures = 0;
    retry.unqueued = false;
  }
  await withdrawGrantsExpiries(jobs);
  getNextlyLogger().info({
    kind: "grants-change-content-expiry-recovered",
    message:
      "The cached pages a change to what a role grants made stale have been expired.",
  });
}
