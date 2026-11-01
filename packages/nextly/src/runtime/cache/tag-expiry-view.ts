/**
 * What nextly's cache handlers know about expired tags, shared by both
 * handlers and every module copy in one process.
 *
 * Next.js loads a cache handler from its file path, outside the app's bundle,
 * and nextly runs as a server external, so the handlers and the app share this
 * module's state through `globalThis`. nextly publishes its ledger here when it
 * registers; until it does, the handlers keep only what this process expired
 * itself, which is all a single instance needs.
 *
 * Before an entry is served, the expiries of the tags it carries are asked of
 * the ledger by key. Each tag's answer is kept for `TAG_LOOKUP_TTL_MS` and
 * reused by every read in that time, and a tag already being asked about is
 * not asked again, so a busy instance reads the ledger a bounded number of
 * times a minute per tag it serves. A write recorded anywhere is therefore
 * seen by every instance within the TTL and one request.
 *
 * @module runtime/cache/tag-expiry-view
 */
import { getNextlyLogger } from "../../observability/logger";

import {
  LEDGER_RETENTION_MS,
  TAG_EXPIRY_GRACE_MS,
  type TagExpiryLedger,
} from "./tag-expiry-ledger";

/** How long a tag's answer from the ledger is reused before it is asked again. */
export const TAG_LOOKUP_TTL_MS = 5_000;

interface TagLookup {
  /** When the tag last expired, on the database's clock; 0 when it never has. */
  expiredAt: number;
  /** When the ledger was asked, on this process's clock. */
  askedAt: number;
}

interface ViewState {
  ledger?: TagExpiryLedger;
  /** The ledger's answers, per tag. */
  lookups: Map<string, TagLookup>;
  /** Tags being asked about now, with the read that will answer them. */
  asking: Map<string, Promise<void>>;
  /**
   * Tags this process expired itself, on this process's clock: converted only
   * when compared, so an offset learned later cannot misplace them.
   */
  own: Map<string, number>;
  /**
   * The ledger times this process's own records wrote, per tag. A lookup
   * answering one of these is judged by `own` and by the database time the
   * record read, not by the grace other instances are held to (this process
   * cleared its registry rows at once).
   */
  mine: Map<string, number>;
  /**
   * The database's clock less this process's, at least, as the latest read
   * that found a row told it; undefined until this copy of the module has
   * learned it. A read's statement ran somewhere between its start and its
   * answer, so the database's time it reported, less the answer's local time,
   * is a lower bound. Judged by it, an entry looks no later than it began, so
   * none begun before an expiry passes for one begun after it: a larger offset
   * would accept stale entries, and a smaller one only costs rebuilds. So the
   * latest bound is taken, however loose: an earlier, tighter one may no
   * longer hold, as after a failover to a database whose clock is behind.
   *
   * Its own name, not the `offsetMs` an earlier copy of this module keeps in
   * this shared state: that copy writes the midpoint of its reads there, which
   * is not a lower bound, and is never read here.
   */
  lowerOffsetMs?: number;
  /** When stale answers were last dropped, on this process's clock. */
  sweptAt: number;
  /** The last time `localNow` gave, so the next is strictly later. */
  lastLocal: number;
  warned: boolean;
}

const globalForView = globalThis as unknown as {
  // A copy of this module from before `mine` was kept may have made it.
  __nextly_tag_expiry_view?: Omit<ViewState, "mine"> & {
    mine?: ViewState["mine"];
  };
};

function state(): ViewState {
  globalForView.__nextly_tag_expiry_view ??= {
    lookups: new Map(),
    asking: new Map(),
    own: new Map(),
    mine: new Map(),
    sweptAt: 0,
    lastLocal: 0,
    warned: false,
  };
  const view = globalForView.__nextly_tag_expiry_view;
  // A bundled or hot-reloaded copy keeps the state an older copy made, which
  // has no `mine`: given one here, the first record would otherwise throw.
  return Object.assign(view, { mine: view.mine ?? new Map() });
}

/** Publishes the ledger the handlers read and record into; `null` withdraws it. */
export function publishTagExpiryLedger(ledger: TagExpiryLedger | null): void {
  const view = state();
  view.ledger = ledger ?? undefined;
  // A new ledger is asked afresh about every tag, and its database's clock
  // is learned afresh.
  view.lookups.clear();
  view.lowerOffsetMs = undefined;
}

/**
 * The offset entries are judged by: the lower bound learned, or none before
 * one is. Only an expiry a lookup found needs it, and a lookup that finds one
 * learns it.
 */
function offsetOf(view: ViewState): number {
  return view.lowerOffsetMs ?? 0;
}

/** Warns once, through nextly's logger, that the ledger could not be used. */
function warnOnce(reason: string, error: unknown): void {
  const view = state();
  if (view.warned) return;
  view.warned = true;
  getNextlyLogger().warn({
    kind: "cache-tag-ledger-unreachable",
    message: `${reason}; cached reads expire only for writes this instance makes until it can`,
    error: error instanceof Error ? error.message : String(error),
  });
}

/**
 * This process's clock, strictly increasing: two calls in one millisecond are
 * still ordered, so an entry stored just after this process's own expiry is
 * never judged by it. Milliseconds, as `Date.now()`, with a fraction added
 * where the clock has not moved.
 */
export function localNow(): number {
  const view = state();
  const now = Date.now();
  view.lastLocal = now > view.lastLocal ? now : view.lastLocal + 0.001;
  return view.lastLocal;
}

/**
 * Drops what can no longer decide anything, at most once a TTL: answers that
 * found no expiry, once past their TTL, which the next read asks again;
 * answers that found one, and own expiries, once older than the ledger keeps
 * one, which every entry they could expire is refused for by age. An expiry
 * is kept through a refresh that fails, so a ledger that goes down cannot make
 * an entry this process knew to be stale look fresh. The maps then hold the
 * tags served lately and those expired lately, not every tag ever seen.
 */
function sweep(view: ViewState, now: number): void {
  if (now - view.sweptAt < TAG_LOOKUP_TTL_MS) return;
  view.sweptAt = now;
  const databaseHorizon = now + offsetOf(view) - LEDGER_RETENTION_MS;
  for (const [tag, lookup] of view.lookups) {
    const drop =
      lookup.expiredAt > 0
        ? lookup.expiredAt < databaseHorizon
        : now - lookup.askedAt >= TAG_LOOKUP_TTL_MS;
    if (drop) view.lookups.delete(tag);
  }
  const horizon = now - LEDGER_RETENTION_MS;
  for (const [tag, expiredAt] of view.own) {
    if (expiredAt < horizon) view.own.delete(tag);
  }
  for (const [tag, storedAt] of view.mine) {
    if (storedAt < databaseHorizon) view.mine.delete(tag);
  }
}

/**
 * Asks the ledger about each of `tags` whose answer is older than the TTL,
 * in one read, sharing any read already under way for the rest. Never throws.
 */
export async function refreshTagExpiries(
  tags: Iterable<string>
): Promise<void> {
  const view = state();
  const now = Date.now();
  sweep(view, now);
  const ledger = view.ledger;
  if (ledger === undefined) return;
  const pending = new Set<Promise<void>>();
  const stale: string[] = [];
  for (const tag of new Set(tags)) {
    const asking = view.asking.get(tag);
    const lookup = view.lookups.get(tag);
    if (asking !== undefined) pending.add(asking);
    else if (
      now - (lookup?.askedAt ?? -Infinity) >= TAG_LOOKUP_TTL_MS ||
      // An expiry an earlier copy of this module looked up, with no offset
      // this copy learned to judge it by: asked again, which tells it.
      (view.lowerOffsetMs === undefined && (lookup?.expiredAt ?? 0) > 0)
    ) {
      stale.push(tag);
    }
  }
  if (stale.length > 0) {
    const read = (async () => {
      try {
        const answer = await ledger.expiriesOf(stale);
        const finishedAt = Date.now();
        // A read that found no rows carries no clock to learn from.
        if (answer?.now !== undefined) {
          view.lowerOffsetMs = answer.now - finishedAt;
        }
        for (const tag of stale) {
          view.lookups.set(tag, {
            expiredAt: answer?.expired.get(tag) ?? 0,
            askedAt: finishedAt,
          });
        }
      } catch (error) {
        warnOnce("the cache tag expiry ledger could not be read", error);
        // Not asked again until the TTL passes, so a ledger that is down is
        // not read on every request; what was known before is kept.
        const failedAt = Date.now();
        for (const tag of stale) {
          view.lookups.set(tag, {
            expiredAt: view.lookups.get(tag)?.expiredAt ?? 0,
            askedAt: failedAt,
          });
        }
      } finally {
        for (const tag of stale) view.asking.delete(tag);
      }
    })();
    for (const tag of stale) view.asking.set(tag, read);
    pending.add(read);
  }
  await Promise.all(pending);
}

/**
 * The ledger's time for `tag` as this process judges by it: another
 * instance's, as stored; for a time this process's own record stored, the
 * database's time that record read, without the grace. This process's expiry
 * is already in `own`, and the grace is for other instances, which may still
 * hold registry rows this process cleared at once: judged by it, an entry this
 * process filled within the grace would be refused once more. The time is
 * still judged by its reading rather than ignored, because another instance
 * may record the same tag in the same millisecond, and only the time says
 * which: an entry begun before that reading is refused, whoever recorded it.
 */
function recordedExpiry(view: ViewState, tag: string): number {
  const recorded = view.lookups.get(tag)?.expiredAt ?? 0;
  return recorded > 0 && view.mine.get(tag) === recorded
    ? recorded - TAG_EXPIRY_GRACE_MS
    : recorded;
}

/** When `tag` last expired as far as this process knows, on the database's clock. */
function expiryOf(view: ViewState, tag: string): number {
  const own = view.own.get(tag);
  return Math.max(
    recordedExpiry(view, tag),
    own === undefined ? 0 : own + offsetOf(view)
  );
}

/**
 * Whether an entry begun at `storedAt` (this process's clock) carrying `tags`
 * must not be served: one of its tags expired after it began, or it is older
 * than the ledger keeps an expiry, past which a pruned row could no longer say
 * so. Asks nothing; `refreshTagExpiries` first.
 */
export function isEntryExpired(
  tags: Iterable<string>,
  storedAt: number
): boolean {
  if (Date.now() - storedAt > LEDGER_RETENTION_MS) return true;
  const view = state();
  const storedOnDatabaseClock = storedAt + offsetOf(view);
  for (const tag of tags) {
    // Another instance's expiry, on the database's clock, has no order with
    // this process's events: at or after, since an entry begun in the same
    // millisecond may hold the old value, and regenerating it costs one read.
    const recorded = recordedExpiry(view, tag);
    if (recorded > 0 && recorded >= storedOnDatabaseClock) return true;
    // This process's own expiry is ordered with its entries by `localNow`, so
    // strictly after: an entry begun once the expiry was made is fresh.
    const own = view.own.get(tag);
    if (own !== undefined && own > storedAt) return true;
  }
  return false;
}

/** The latest expiry among `tags`, on this process's clock; 0 when none expired. */
export function latestExpiry(tags: Iterable<string>): number {
  const view = state();
  let latest = 0;
  for (const tag of tags) {
    const expiredAt = expiryOf(view, tag);
    if (expiredAt > 0) latest = Math.max(latest, expiredAt - offsetOf(view));
  }
  return latest;
}

/**
 * What became of an expiry outside this process: recorded in the ledger; no
 * ledger published; no table yet (a migration not run, so no instance shares
 * expiries yet); or a write the database refused, which a retry may get past.
 */
export type ExpiryRecord = "recorded" | "no-ledger" | "no-table" | "failed";

/**
 * Expires `tags` now: in this process at once, so this instance never serves
 * its own write stale, and in the ledger for every other instance. A refused
 * write is warned about once. This instance stays correct whatever the
 * answer; a caller that must reach other instances decides from it whether to
 * keep the tags.
 */
export async function expireTags(
  tags: readonly string[]
): Promise<ExpiryRecord> {
  const view = state();
  const now = localNow();
  for (const tag of tags) view.own.set(tag, now);
  if (view.ledger === undefined) return "no-ledger";
  try {
    const stored = await view.ledger.record(tags);
    if (stored === false) return "no-table";
    for (const [tag, at] of stored) view.mine.set(tag, at);
    return "recorded";
  } catch (error) {
    warnOnce("the cache tag expiry ledger could not record an expiry", error);
    return "failed";
  }
}
