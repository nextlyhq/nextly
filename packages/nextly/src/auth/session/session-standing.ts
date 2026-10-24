/**
 * Whether the account an access token names may still use it.
 *
 * An access token is signed, so checking its signature says only that core
 * issued it. Deactivating the account, or an administrator setting its
 * password, has to end the sessions the account already holds, and a token
 * outlives either change by up to its whole lifetime: fifteen minutes from the
 * login endpoint, thirty days from the Direct API's `nextly.login()`. So every
 * place a session is read also asks the account's row two things: is it
 * active, and is its session epoch the one the token was signed at?
 *
 * ## The session epoch
 *
 * A number on the user row that rises whenever the account's sessions are
 * ended (`updateUserEndingSessions`), and that every access token carries as
 * its `nx_sev` claim. A token signed before the change carries the old number and
 * is refused; one signed after carries the new number. Comparing numbers
 * rather than times means no clock is involved: a token issued in the same
 * second as the change, or on an instance whose clock runs ahead, is judged
 * exactly. A token signed before the claim existed carries none, which reads
 * as epoch zero, where every account starts, so it keeps working until the
 * account's first change and not after it.
 *
 * The active flag is read from the same row because it costs nothing more,
 * and it catches a deactivation that reached the row some other way, such as
 * an operator's own update.
 *
 * ## Cached for a few seconds, and why that is the bound
 *
 * An active account's row is read at most once per
 * {@link SESSION_STANDING_TTL_MS} per process, which turns a read on every
 * request into one per active person every few seconds. Another instance's
 * change reaches this one only through the database, so that lifetime is the
 * bound on how long a token can outlive the change, and the documentation
 * states it as {@link SESSION_CUTOFF_SECONDS}. The instance that makes the
 * change drops its own entry at once ({@link forgetSessionStanding}).
 *
 * The cache can only ever be slow to refuse, never slow to admit: a refusal
 * is not kept, so a reactivated account's next sign-in is seen at once, and a
 * token newer than the held answer proves that answer stale and reads again.
 *
 * A failed read is never cached and is never an answer: the error travels, so
 * the request fails rather than being let through or signed out.
 *
 * @module auth/session/session-standing
 */
import type { DrizzleAdapter } from "@nextlyhq/adapter-drizzle";
import { eq } from "drizzle-orm";

import { getDialectTables } from "../../database/index";
import { container } from "../../di/container";
import { NextlyError } from "../../errors/nextly-error";
import { awaitBootMigrations } from "../../init/boot-migrations-gate";
import { serializeOnSqlite } from "../../shared/lib/run-adapter-transaction";
import { SESSION_EPOCH_CLAIM } from "../jwt/claims";

/** What the user row says about the sessions the account may hold. */
export interface SessionStanding {
  isActive: boolean;
  sessionEpoch: number;
}

/** Reads one account's standing; null when the account no longer exists. */
export type ReadSessionStanding = (
  userId: string
) => Promise<SessionStanding | null>;

/**
 * How long a read of an account's standing is reused.
 *
 * Half the documented bound, so a change is seen everywhere within it with
 * room for a request that was already past the check when the change landed.
 */
export const SESSION_STANDING_TTL_MS = 5_000;

/**
 * The bound the documentation states: within this many seconds of an account
 * being deactivated, or of an administrator setting its password, every
 * access token issued to it before is refused.
 */
export const SESSION_CUTOFF_SECONDS = 10;

/**
 * How many accounts one process keeps an answer for. The oldest answer goes to
 * make room, and costs one read when that person's next request arrives.
 */
const MAX_ENTRIES = 10_000;

export interface SessionStandingCache {
  /**
   * The account's standing, as fresh as a token signed at `tokenEpoch` needs.
   *
   * Served from memory only while the held answer is fresh, is for an active
   * account, and is at least as new as the token: a token can only carry an
   * epoch the row once held, so one newer than the held answer means the held
   * answer is stale, and the row is read again rather than refusing a session
   * just signed.
   */
  standing(userId: string, tokenEpoch: number): Promise<SessionStanding | null>;
  /**
   * Drop what is held for the account, so its next request reads the row.
   *
   * `writing` answers whether the change that made this call is still
   * uncommitted. While it answers true nothing read for the account is kept,
   * however long that takes; without it, nothing is kept for one lifetime.
   */
  forget(userId: string, writing?: () => boolean): void;
  /**
   * The forgets whose change is still uncommitted, each with the check that
   * says when it commits. A cache replaced while one is open hands them to
   * its replacement, which must not keep that change's old row either.
   */
  uncommitted(): Array<{ userId: string; writing: () => boolean }>;
}

/** A read of one account's row, and whether a `forget` has overtaken it. */
interface Reading {
  promise: Promise<SessionStanding | null>;
  superseded: boolean;
}

/**
 * A per-process cache of account standings over `read`.
 *
 * Only an active account's standing is kept. A refusal — an account that is
 * not active, or no longer exists — is read again on the next request, so
 * reactivating an account, here or on another instance, is seen by the next
 * sign-in at once rather than refusing its new session for the lifetime. The
 * cost is one read per request carrying a token for such an account, which is
 * the per-request read the cache otherwise saves; tokens older than a held
 * active epoch are still refused from memory.
 *
 * One read runs per account at a time, and callers arriving while it runs
 * share it. A {@link SessionStandingCache.forget} while a read is running
 * marks that read superseded, because it may have queried before the change:
 * its answer goes to the callers already waiting and is not kept. The mark
 * lives on the read and goes with it.
 *
 * A read that BEGINS after a forget can still be early: the writer forgets
 * inside its transaction, and until that commits another connection reads the
 * row as it was. So for one lifetime after a forget nothing read for the
 * account is kept, and each request reads the row, which is what lets the
 * instance that made the change refuse at once on every dialect.
 *
 * A caller for whom `shared` answers false reads alone. It may take a held
 * answer, which was read and committed before it, but it neither joins a read
 * that is running nor lets another caller join or keep its own. On SQLite that
 * is a caller inside an open transaction: a read started elsewhere is queued
 * behind that transaction, so joining it would wait on the transaction that is
 * waiting for it, and its own read runs inside the transaction, where the row
 * may hold a change that has not committed.
 */
export function createSessionStandingCache(options: {
  read: ReadSessionStanding;
  ttlMs?: number;
  maxEntries?: number;
  now?: () => number;
  shared?: () => boolean;
}): SessionStandingCache {
  const ttlMs = options.ttlMs ?? SESSION_STANDING_TTL_MS;
  const maxEntries = options.maxEntries ?? MAX_ENTRIES;
  // A monotonic clock, so setting the wall clock back cannot stretch an
  // answer's lifetime past the bound.
  const now = options.now ?? (() => performance.now());
  const held = new Map<string, { standing: SessionStanding; readAt: number }>();
  const reading = new Map<string, Reading>();
  // When each account was last forgotten, and whether the change that forgot
  // it is still being written. A writer forgets inside its transaction, and
  // on PostgreSQL and MySQL a read on another connection before the commit
  // still sees the old row, so no read that BEGINS while that transaction is
  // open, or within a lifetime of the forget, is kept: it is answered, and
  // the next request reads again. The lifetime is the floor for a writer that
  // cannot say when it commits. Past both the mark goes, and so does the cost.
  const forgotten = new Map<string, { at: number; writing?: () => boolean }>();

  function recentlyForgotten(userId: string, readAt: number): boolean {
    const mark = forgotten.get(userId);
    if (mark === undefined) return false;
    if (mark.writing?.() === true) return true;
    // A negative age is a clock that moved backward, which proves nothing
    // about the change having committed, so it still counts as recent.
    const age = readAt - mark.at;
    if (age >= 0 && age >= ttlMs) {
      forgotten.delete(userId);
      return false;
    }
    return true;
  }

  function keep(
    userId: string,
    standing: SessionStanding,
    readAt: number
  ): void {
    held.delete(userId);
    if (held.size >= maxEntries) {
      // A Map iterates in insertion order, so the first key is the oldest.
      const oldest = held.keys().next();
      if (!oldest.done) held.delete(oldest.value);
    }
    held.set(userId, { standing, readAt });
  }

  function readRow(userId: string): Promise<SessionStanding | null> {
    const running = reading.get(userId);
    if (running) return running.promise;
    // Aged from when the query was sent, not from when it came back: the row
    // it answers with may be from before a change made while it was slow, and
    // the bound is counted from that change.
    const startedAt = now();
    // Judged as the read begins: one sent before the change committed answers
    // with the old row even if it returns after the commit.
    const keepable = !recentlyForgotten(userId, startedAt);
    const entry: Reading = {
      superseded: false,
      promise: options
        .read(userId)
        .then(standing => {
          // Older than the lifetime before it arrived: the row it answers
          // with may be from before a change that has since passed the
          // bound, so neither the waiting requests nor the cache take it. A
          // read that slow is the database failing to answer in time, and is
          // treated as a failed read.
          if (now() - startedAt >= ttlMs) {
            throw NextlyError.serviceUnavailable({
              logMessage:
                "session check: the account read took longer than the " +
                "standing cache's lifetime, so its answer was not used",
            });
          }
          if (!entry.superseded && standing?.isActive === true && keepable) {
            keep(userId, standing, startedAt);
          }
          return standing;
        })
        .finally(() => {
          if (reading.get(userId) === entry) reading.delete(userId);
        }),
    };
    reading.set(userId, entry);
    return entry.promise;
  }

  return {
    standing(userId, tokenEpoch) {
      const entry = held.get(userId);
      // A negative age is a clock that moved backward, which says nothing
      // about how old the answer is, so it is read again.
      const age = entry ? now() - entry.readAt : -1;
      if (
        entry &&
        age >= 0 &&
        age < ttlMs &&
        entry.standing.sessionEpoch >= tokenEpoch
      ) {
        return Promise.resolve(entry.standing);
      }
      if (options.shared?.() === false) return options.read(userId);
      const joined = reading.has(userId);
      const read = readRow(userId);
      if (!joined) return read;
      // The read this caller joined may have queried before a change made on
      // another instance: the one that signed this token's epoch, or the
      // account's reactivation, which leaves the epoch where it was. An answer
      // that is not active, or is older than the token, proves that, so it
      // reads once more for itself.
      return read.then(standing =>
        standing?.isActive !== true || standing.sessionEpoch < tokenEpoch
          ? readRow(userId)
          : standing
      );
    },

    forget(userId, writing) {
      held.delete(userId);
      forgotten.delete(userId);
      if (forgotten.size >= maxEntries) {
        // Insertion order again: the oldest mark is the nearest to lapsing.
        // A mark whose change is still uncommitted is never the one to go:
        // it is the only thing keeping that change's old row out of the
        // cache. With every mark still open, which takes that many writers
        // open at once, the marks grow rather than drop one.
        for (const [id, mark] of forgotten) {
          if (mark.writing?.() !== true) {
            forgotten.delete(id);
            break;
          }
        }
      }
      forgotten.set(userId, { at: now(), ...(writing ? { writing } : {}) });
      const running = reading.get(userId);
      if (running) {
        running.superseded = true;
        reading.delete(userId);
      }
    },

    uncommitted() {
      const open: Array<{ userId: string; writing: () => boolean }> = [];
      for (const [userId, mark] of forgotten) {
        if (mark.writing?.() === true) {
          open.push({ userId, writing: mark.writing });
        }
      }
      return open;
    },
  };
}

/**
 * The session epoch a token was signed at.
 *
 * A token with no epoch claim was signed before the claim existed and reads
 * as epoch zero. One whose claim is not a whole number of zero or more was
 * not signed by core, and answers undefined, which the check refuses.
 */
function tokenEpoch(claims: Record<string, unknown>): number | undefined {
  const signed = Object.prototype.hasOwnProperty.call(
    claims,
    SESSION_EPOCH_CLAIM
  )
    ? claims[SESSION_EPOCH_CLAIM]
    : 0;
  if (typeof signed !== "number" || !Number.isSafeInteger(signed)) {
    return undefined;
  }
  return signed < 0 ? undefined : signed;
}

/** How a token is judged against its account's standing. */
export interface StandingCheckOptions {
  /**
   * Whether an account that is not active refuses the token. True everywhere
   * a session grants something. The account-state route alone asks with
   * false, because reporting an inactive account as `disabled` is what it is
   * for; a deactivation through core still refuses there, since it ends the
   * account's sessions and so moves the epoch.
   */
  activeOnly?: boolean;
}

/**
 * Whether `standing` admits a token carrying `claims`.
 *
 * Refused when the account no longer exists, is not active (unless
 * `activeOnly` is false), or has had its sessions ended since the token was
 * signed, and when the token's epoch claim is malformed.
 */
export function standingAdmits(
  standing: SessionStanding | null,
  claims: Record<string, unknown>,
  options?: StandingCheckOptions
): boolean {
  if (!standing) return false;
  if (options?.activeOnly !== false && !standing.isActive) return false;
  const signed = tokenEpoch(claims);
  return signed !== undefined && signed === standing.sessionEpoch;
}

/**
 * How a process that has not registered its services starts them, set by the
 * route handler that owns that start. Unset where nothing can start them.
 */
let boot: (() => Promise<void>) | undefined;

/**
 * Let the authentication checks start services that are not registered yet.
 *
 * Some routes authenticate before the process has booted, so that a request
 * without a credential cannot make it boot. Both credentials that need the
 * database to be judged start the services through this one boot, by way of
 * `startServicesForAuthentication`: a session token whose signature has
 * already verified, and an API key, which can only be looked up there. Each is
 * a request the route would boot for next.
 */
export function setSessionStandingBoot(
  start: (() => Promise<void>) | undefined
): void {
  boot = start;
}

/**
 * Start the services when none are registered and something can start them,
 * then wait on the boot migrations, so a credential is never judged against a
 * schema this process has not confirmed.
 *
 * The one way an authentication check reaches a cold process: the session
 * standing read and the API key lookup both call it, so a signed-in request
 * and a request with a key start the same boot and wait on the same gate.
 * Ready only once registration has finished, not as soon as a service is in
 * the container: registration puts its services there before it runs the boot
 * migrations, and a read in between may meet a column those migrations are
 * still adding. Throws what the boot or the gate throws.
 */
export async function startServicesForAuthentication(): Promise<void> {
  // Loaded on first use, as this module is imported by every session read and
  // the registry imports most of core.
  const { isServicesRegistered } = await import("../../di/register");
  if (!isServicesRegistered() && boot) await boot();
  // The gate every serving surface waits on (`getCachedNextly()` does too):
  // a boot still migrating is waited for, and one that refused keeps
  // refusing here.
  await awaitBootMigrations();
}

function adapterIsRegistered(): boolean {
  try {
    return container.has("adapter");
  } catch {
    return false;
  }
}

/** The narrow view of the query builder the standing read uses. */
interface StandingSelect {
  select(projection: Record<string, unknown>): {
    from(table: unknown): {
      where(condition: unknown): {
        limit(
          count: number
        ): Promise<
          Array<{ isActive: boolean | null; sessionEpoch: number | null }>
        >;
      };
    };
  };
}

/**
 * The adapter the standing is read through, starting the services first when
 * none is registered and something can start them.
 *
 * Throws, rather than answering, when no database can be reached, because a
 * question nobody could answer is not a yes. That is a process where Nextly
 * has not been initialised and no Nextly route has been loaded to start it,
 * such as an app's own route running in a function of its own, so the log
 * names the one line that fixes it.
 */
async function standingAdapter(): Promise<DrizzleAdapter> {
  // The start an API key's lookup shares, so both credentials meet a cold
  // process the same way.
  await startServicesForAuthentication();
  const { isServicesRegistered } = await import("../../di/register");
  if (!isServicesRegistered() || !adapterIsRegistered()) {
    throw NextlyError.internal({
      logContext: {
        reason: "session-read-before-nextly-initialised",
        remedy:
          "A session was read before Nextly was initialised in this " +
          "process, so whether its account may still use it cannot be " +
          "checked. Call `await getNextly({ config })` before `getSession` " +
          "or `requireAuth`, or initialise Nextly in `instrumentation.ts` " +
          "with `createRegister(config)`.",
      },
    });
  }
  return container.get<DrizzleAdapter>("adapter");
}

/**
 * Read one account's standing from the database: one primary-key read of the
 * two columns the check needs.
 */
export async function readSessionStanding(
  userId: string,
  through?: DrizzleAdapter
): Promise<SessionStanding | null> {
  const adapter = through ?? (await standingAdapter());
  const { users } = getDialectTables(adapter.getCapabilities().dialect);
  // Typed by the narrow view it is used through, as the RBAC epoch's read is.
  const db: StandingSelect = adapter.getDrizzle();
  // Through `serializeOnSqlite`, so on SQLite, where every request shares one
  // connection, the read queues behind another request's open transaction
  // rather than running inside it: an epoch raised by a write that then rolls
  // back would otherwise be cached, and refuse the account's live session.
  const rows = await serializeOnSqlite(adapter, () =>
    db
      .select({ isActive: users.isActive, sessionEpoch: users.sessionEpoch })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1)
  );
  const row = rows[0];
  if (!row) return null;
  // Null on a row written before the column existed, which is epoch zero.
  return {
    isActive: row.isActive === true,
    sessionEpoch: Number(row.sessionEpoch ?? 0),
  };
}

/**
 * The process's cache, and the adapter whose database its answers came from.
 *
 * An answer belongs to the database that gave it. When the registered
 * adapter is replaced — services registered again after a configuration
 * change, or another database entirely — every answer held is about rows that
 * may not exist there, so the cache starts again empty.
 */
let held: { cache: SessionStandingCache; adapter: DrizzleAdapter } | null =
  null;
let cacheClock: (() => number) | undefined;

/**
 * The adapters the cache has belonged to lately, newest last. Services
 * registered again bring a new adapter while a write on an old one may still
 * be open, and only the adapter a write runs on can say whether it has
 * committed, so a forget asks these as well as the registered one. Held
 * weakly, so an adapter that is gone, and its connections, can be collected.
 */
const MAX_RECENT_ADAPTERS = 4;
let recentAdapters: Array<WeakRef<DrizzleAdapter>> = [];

function rememberAdapter(adapter: DrizzleAdapter): void {
  recentAdapters = [
    ...recentAdapters.filter(ref => {
      const known = ref.deref();
      return known !== undefined && known !== adapter;
    }),
    new WeakRef(adapter),
  ].slice(-MAX_RECENT_ADAPTERS);
}

function cacheFor(adapter: DrizzleAdapter): SessionStandingCache {
  if (held?.adapter !== adapter) {
    rememberAdapter(adapter);
    // A change still uncommitted when services are registered again keeps
    // its mark: the new cache would otherwise keep a read of the old row the
    // moment its first request arrives. The answers held are not carried;
    // they belong to the database that gave them.
    const carried = held?.cache.uncommitted() ?? [];
    held = {
      cache: createSessionStandingCache({
        read: userId => readSessionStanding(userId, adapter),
        // Inside an open transaction a read nests in it rather than queueing,
        // so it must not be shared across that boundary in either direction.
        shared: () => !adapter.inTransaction(),
        ...(cacheClock ? { now: cacheClock } : {}),
      }),
      adapter,
    };
    for (const { userId, writing } of carried) {
      held.cache.forget(userId, writing);
    }
  }
  return held.cache;
}

/**
 * Whether the account a verified session token names may still use it.
 *
 * Every place that turns a session token into a signed-in person asks this
 * after the signature has verified.
 */
export async function sessionTokenIsCurrent(
  claims: Record<string, unknown>,
  options?: StandingCheckOptions
): Promise<boolean> {
  const userId = claims.sub;
  if (typeof userId !== "string" || userId === "") return false;
  const signed = tokenEpoch(claims);
  if (signed === undefined) return false;
  const standing = await cacheFor(await standingAdapter()).standing(
    userId,
    signed
  );
  return standingAdmits(standing, claims, options);
}

/**
 * Whether the account is active, read through the same cache as a session's
 * standing, so the bound and the local refusal on deactivation are the ones
 * sessions have.
 *
 * Asked at epoch zero, which every held answer is at least as new as: only
 * the active flag matters here, and ending an account's sessions, as a new
 * password does, does not make it inactive. A failed read throws, as it does
 * for a session.
 */
export async function accountIsActive(userId: string): Promise<boolean> {
  const standing = await cacheFor(await standingAdapter()).standing(userId, 0);
  return standing?.isActive === true;
}

/**
 * Drop this process's answer for the account, after a change that ends its
 * sessions, so the instance that made the change refuses the old tokens
 * without waiting out the cache.
 *
 * `writer` is the adapter the change's transaction runs on, which is the one
 * that can say when it commits.
 */
export function forgetSessionStanding(
  userId: string | number,
  writer?: DrizzleAdapter
): void {
  // The registered adapter first: after services are registered again, the
  // cache can still belong to the adapter they replaced until something reads
  // through the new one, and a mark left there is one the next read never
  // sees. The cache is made here when no request has made it yet, for the
  // same reason.
  const adapter = adapterIsRegistered()
    ? container.get<DrizzleAdapter>("adapter")
    : held?.adapter;
  if (adapter === undefined) return;
  // Whether the change that made this call has committed: a transaction this
  // flow is inside is still open, which every dialect answers. Asked first of
  // `writer`, the adapter the change's transaction was opened on, which alone
  // knows when services registered again have replaced it before the cache
  // ever read through it; then of the registered adapter and of those the
  // cache served lately, for a caller that cannot say.
  const writers = new Set<DrizzleAdapter>(
    writer ? [writer, adapter] : [adapter]
  );
  for (const ref of recentAdapters) {
    const known = ref.deref();
    if (known !== undefined) writers.add(known);
  }
  const writing = watchTransaction(() =>
    [...writers].some(writer => writer.transactionOpenInFlow())
  );
  cacheFor(adapter).forget(String(userId), writing);
}

/**
 * Whether `isOpen` answers yes. A probe that fails is not a yes: watching
 * stops, and the mark falls back to its fixed lifetime, rather than an
 * error escaping from a timer no request is waiting on.
 */
function openNow(isOpen: () => boolean): boolean {
  try {
    return isOpen();
  } catch {
    return false;
  }
}

/** How often {@link watchTransaction} asks whether the transaction ended. */
const TRANSACTION_WATCH_MS = 50;

/**
 * Whether the calling flow's transaction is still open, readable from any
 * other request; undefined when the caller is in no transaction.
 *
 * `isOpen` can only answer in the calling flow's own async context, so it is
 * asked from a timer started here, which runs in that context, until it says
 * no. What the returned reader keeps is the answer alone. The timer holds
 * the context only while the transaction is open, and lets it go within one
 * interval of its end; it never keeps the process alive.
 */
export function watchTransaction(
  isOpen: () => boolean,
  intervalMs = TRANSACTION_WATCH_MS
): (() => boolean) | undefined {
  if (!openNow(isOpen)) return undefined;
  let open = true;
  const check = (): void => {
    if (openNow(isOpen)) {
      setTimeout(check, intervalMs).unref?.();
      return;
    }
    open = false;
  };
  setTimeout(check, intervalMs).unref?.();
  return () => open;
}

/**
 * Start again from an empty cache, optionally reading a test's clock, so a
 * test can move past the bound without waiting for it.
 */
export function resetSessionStandingForTests(options?: {
  now?: () => number;
}): void {
  held = null;
  recentAdapters = [];
  cacheClock = options?.now;
}
