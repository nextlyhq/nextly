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
import {
  buildCollectionRevalidationIntent,
  buildSingleRevalidationIntent,
  readRevalidateConfig,
} from "../revalidation/intent-builders";
import type {
  CacheRevalidator,
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
 * each caller says what it could not refresh.
 */
export async function flushEveryContentScope(
  cache: LanguageChangeContentCache
): Promise<void> {
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
  await revalidator.flush([{ tags: [...tags] }]);
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
}

// One per process, across module copies, like the expiry hand-off.
const globalForGrantsExpiry = globalThis as unknown as {
  __nextly_grants_expiry_retry?: GrantsExpiryRetry;
};

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
 */
export async function expireContentAfterGrantsChange(): Promise<void> {
  // Loaded here rather than at the top, for the reason `flushContentChange` gives: the permission
  // writers that call this are reached from CLI paths that never load the service registry.
  const [{ languageChangeContentCache }, { getNextlyLogger }] =
    await Promise.all([
      import("../di/registrations/language-change-content-cache"),
      import("../observability/logger"),
    ]);
  // A process that caches nothing has nothing to expire, here or later, as before.
  if (!languageChangeContentCache().revalidator()) return;
  const job = await queueGrantsExpiry();
  let failure: unknown;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await flushEveryContentScope(languageChangeContentCache());
      if (job !== undefined) await withdrawGrantsExpiries([job]);
      return;
    } catch (error) {
      failure = error;
    }
  }
  const retry = grantsExpiryRetry();
  retry.failures += 1;
  if (job === undefined) retry.unqueued = true;
  else retry.queued.add(job);
  getNextlyLogger().error({
    kind: "grants-change-content-expiry-failed",
    message: `What a role grants changed, but cached pages could not be expired yet: ${
      failure instanceof Error ? failure.message : String(failure)
    }. Until they are, a cached page may keep what the change took away; this process tries again${
      job === undefined
        ? ""
        : ", and the jobs queue holds it for the next jobs run"
    }.`,
  });
  scheduleGrantsExpiry(retry);
}

/**
 * Queues the expiry as a job and resolves its id, or `undefined` where there is no jobs queue (a
 * CLI path) or it refused the row: the expiry is then owed by this process alone.
 */
async function queueGrantsExpiry(): Promise<string | undefined> {
  const { container } = await import("../di/container");
  if (!container.has("jobsRepository")) return undefined;
  try {
    const { id } = await container
      .get<JobsRepository>("jobsRepository")
      .enqueue({
        slug: GRANTS_CONTENT_EXPIRY_JOB,
        input: null,
        runAt: null,
        runAsUserId: null,
        // One row per change: a key would fold a change into a job already running, whose
        // expiry may have landed before this change committed.
        dedupeKey: null,
        now: new Date(),
      });
    return id;
  } catch {
    return undefined;
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
  const failuresBefore = retry.failures;
  const jobs = [...retry.queued];
  try {
    await flushEveryContentScope(languageChangeContentCache());
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
