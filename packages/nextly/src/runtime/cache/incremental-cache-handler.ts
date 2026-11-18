/**
 * nextly's incremental cache handler, Next.js's `cacheHandler`: the store for
 * `unstable_cache` reads and for rendered pages and route responses.
 *
 * Entries are kept in this instance's memory. Whether one may still be served
 * is asked of the tag expiry ledger every instance shares, so a write made on
 * another instance, or outside any request, expires it here too. Configured in
 * `next.config` with `cacheMaxMemorySize: 0`, so Next.js keeps no second copy.
 *
 * @module runtime/cache/incremental-cache-handler
 */

import { awaitStartInFlight, startInFlight } from "../../init/start-in-flight";

import { sharedEntries } from "./bounded-entries";
import {
  buildOutputReader,
  type BuildOutputEntry,
  type CacheHandlerContext,
} from "./build-output";
import { holdFailedRecord, retryFailedRecordsAtRead } from "./record-retry";
import { markIncrementalHandlerInUse } from "./shared-handlers";
import {
  expireTags,
  isEntryExpired,
  localNow,
  refreshTagExpiries,
  tagExpiryLedgerPublished,
  whenTagExpiryLedgerPublished,
} from "./tag-expiry-view";

interface StoredEntry {
  value: unknown;
  lastModified: number;
  /** When the fill that made it began, on `localNow`'s clock: what it is judged by. */
  begunAt: number;
  tags: readonly string[];
  // The lifetime Next.js derives a route's revalidation from, handed back as
  // given: an entry without it would revalidate after a second.
  cacheControl?: unknown;
}

interface CacheContext {
  cacheControl?: unknown;
  tags?: readonly string[];
  softTags?: readonly string[];
  /** The kind of entry asked for: a page, a route response, a fetch. */
  kind?: unknown;
}

/** The tags a stored page or response carries in its cache-tags header. */
/**
 * How Next.js begins the tags it derives from a page's path (`_N_T_/admin`),
 * as against the tags its reads name.
 */
const NEXT_IMPLICIT_TAG_PREFIX = "_N_T_";

function headerTags(value: unknown): string[] {
  const header = (value as { headers?: Record<string, unknown> } | null)
    ?.headers?.["x-next-cache-tags"];
  return typeof header === "string" ? header.split(",") : [];
}

/**
 * A rough size for the bound, walking the value rather than serialising it:
 * a page's `segmentData` is a Map of Buffers, which JSON writes as `{}`, so a
 * serialised length would let a large prerender pass as a few bytes. Bytes are
 * counted for buffers, characters for strings and keys, and a few bytes for
 * anything else; a value seen twice is counted once.
 */
function sizeOf(value: unknown, seen = new WeakSet<object>()): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "string") return value.length;
  if (typeof value !== "object") return 8;
  if (seen.has(value)) return 0;
  seen.add(value);
  if (ArrayBuffer.isView(value)) return value.byteLength;
  if (value instanceof ArrayBuffer) return value.byteLength;
  let bytes = 0;
  if (value instanceof Map) {
    for (const [key, part] of value) {
      bytes += sizeOf(key, seen) + sizeOf(part, seen);
    }
    return bytes;
  }
  if (value instanceof Set || Array.isArray(value)) {
    for (const part of value) bytes += sizeOf(part, seen);
    return bytes;
  }
  for (const [key, part] of Object.entries(value)) {
    bytes += key.length + sizeOf(part, seen);
  }
  return bytes;
}

/** Stored pages, routes and fetches, shared by every handler Next.js makes. */
// Looked up on each use, so the store a test resets is the one read.
const entries = () => sharedEntries<StoredEntry>("incremental");

/**
 * How long after a read of its key a `set` is taken as that read's fill. A
 * fill longer than this is stamped when it is stored, as one with no read.
 */
const FILL_WINDOW_MS = 60_000;

/** At most this many reads are remembered before the old ones are dropped. */
const MAX_REMEMBERED_READS = 10_000;

/**
 * A remembered read of a key: when it was made, and what it answered so far.
 * `reading` until the handler answers it; `missed` when it answered nothing,
 * so Next.js renders the key; `served` when it answered a stored entry.
 */
interface RememberedRead {
  at: number;
  answer: "reading" | "missed" | "served";
}

const globalForReads = globalThis as unknown as {
  __nextly_cache_reads?: Map<string, RememberedRead>;
};

/**
 * When each key was last read, by any handler Next.js makes. Next.js fills a
 * key after a read misses it or finds it stale, so the read marks when the
 * fill began: an expiry recorded while it ran then judges what it stores,
 * instead of the fill passing for fresh because it finished later.
 */
function reads(): Map<string, RememberedRead> {
  globalForReads.__nextly_cache_reads ??= new Map();
  return globalForReads.__nextly_cache_reads;
}

/**
 * Remembers a read of `key`, and answers the record to mark with what the
 * read answers (`undefined` when it could not be remembered).
 */
function rememberRead(key: string): RememberedRead | undefined {
  const remembered = reads();
  const now = localNow();
  // A render of this key that a missed read within the window started is
  // still the one being filled: a later read of the same key is served that
  // render, so it does not move when the render began. Moved, a render begun
  // before an expiry and stored after it would be dated after the expiry, and
  // kept. A read still being answered may yet miss, so it holds too. A read
  // answered from the store started no render, so a later read starts afresh:
  // kept, it would date a render begun after an expiry from before it, and
  // refuse it once more than the expiry needs.
  const earlier = remembered.get(key);
  const read =
    earlier !== undefined &&
    earlier.answer !== "served" &&
    now - earlier.at <= FILL_WINDOW_MS
      ? earlier
      : { at: now, answer: "reading" as const };
  remembered.delete(key);
  if (remembered.size >= MAX_REMEMBERED_READS) {
    // Reads past the window mark no fill still running, so they go first.
    // Not in time order: a read that holds an earlier one's start is put
    // back last with that start, so every entry is looked at.
    for (const [old, { at }] of remembered) {
      if (now - at > FILL_WINDOW_MS) remembered.delete(old);
    }
  }
  if (remembered.size >= MAX_REMEMBERED_READS) {
    // Still full, of reads whose fills may be running: none is dropped, since
    // that fill would lose when it began. This read is not remembered, and
    // its fill is judged as one begun at the window's start (`fillBegan`).
    return undefined;
  }
  remembered.set(key, read);
  return read;
}

/**
 * Whether Next.js will fill `stored` again in the background as it serves it:
 * its revalidate time (the route's cache control, or a cached fetch's own) has
 * passed. When that time cannot be read it is taken as passed, so the read
 * holds its start: at worst one render more after an expiry, never a stale
 * one kept.
 */
function dueForRevalidation(stored: StoredEntry): boolean {
  const seconds =
    revalidateOf(stored.cacheControl) ?? revalidateOf(stored.value);
  if (seconds === false) return false;
  if (seconds === undefined) return true;
  return Date.now() - stored.lastModified >= seconds * 1000;
}

/** The `revalidate` an object carries: seconds, `false` for never, or `undefined`. */
function revalidateOf(holder: unknown): number | false | undefined {
  if (typeof holder !== "object" || holder === null) return undefined;
  if (!("revalidate" in holder)) return undefined;
  const { revalidate } = holder;
  return typeof revalidate === "number" || revalidate === false
    ? revalidate
    : undefined;
}

/**
 * Marks what a remembered read answered. A read that another read of the
 * same key has since joined is marked as missed if either missed, since a
 * render either started is still the one being filled.
 */
function markAnswer(
  read: RememberedRead | undefined,
  answer: "missed" | "served"
): void {
  if (read === undefined || read.answer === "missed") return;
  read.answer = answer;
}

/**
 * When the fill being stored for `key` began: its read; else the window's
 * start, so a fill no kept read dates is judged stale by any expiry recorded
 * within the window, which it may have run across.
 *
 * A fill with no read is not rare. Next.js serves a path no build listed from
 * its route's fallback shell, then renders that path's own page in the
 * background and stores it without asking for its key first. Dated when it
 * was stored, a page drawn before a write that landed while it rendered was
 * kept, and its previous version served. Dated at the window's start, such a
 * page is kept only once no write to its tags is that recent; until then the
 * next request renders it again.
 */
function fillBegan(key: string): number {
  const remembered = reads();
  const readAt = remembered.get(key)?.at;
  remembered.delete(key);
  const now = localNow();
  if (readAt !== undefined && now - readAt <= FILL_WINDOW_MS) return readAt;
  return now - FILL_WINDOW_MS;
}

/**
 * Whether what expired can be asked of the ledger: at once when it is
 * published; when a start is under way, once that start publishes it (as soon
 * as its database connects) or ends without it; otherwise not.
 */
async function expiriesCanBeAsked(): Promise<boolean> {
  if (tagExpiryLedgerPublished()) return true;
  if (startInFlight() === null) return false;
  await Promise.race([whenTagExpiryLedgerPublished(), awaitStartInFlight()]);
  return tagExpiryLedgerPublished();
}

export default class NextlyIncrementalCacheHandler {
  /** The pages and responses the build wrote to disk, read on a miss. */
  private readonly fromBuild: ReturnType<typeof buildOutputReader>;

  // Next.js constructs the configured handler for each request and build
  // before it renders, so reads this process caches keep their lifetimes.
  constructor(ctx?: CacheHandlerContext) {
    markIncrementalHandlerInUse();
    this.fromBuild = buildOutputReader(ctx);
  }

  async get(
    key: string,
    ctx?: CacheContext
  ): Promise<{
    lastModified: number;
    value: unknown;
    cacheControl?: unknown;
  } | null> {
    const read = rememberRead(key);
    const stored = await this.freshEntry(key, ctx);
    // A miss sets off a render, and so does an entry served past its
    // revalidate time (Next.js fills it again in the background): either read
    // holds its start, as the render's. One served within its time started
    // no render.
    markAnswer(
      read,
      stored === undefined || dueForRevalidation(stored) ? "missed" : "served"
    );
    if (stored === undefined) return null;
    return {
      lastModified: stored.lastModified,
      value: stored.value,
      cacheControl: stored.cacheControl,
    };
  }

  /** The entry stored for `key` while none of its tags expired after it began. */
  private async freshEntry(
    key: string,
    ctx: CacheContext | undefined
  ): Promise<StoredEntry | undefined> {
    // Where a timer may never fire, a read retries what the ledger refused.
    const retrying = retryFailedRecordsAtRead();
    if (retrying !== undefined) await retrying;
    const stored = entries().get(key) ?? (await this.storedFromBuild(key, ctx));
    if (stored === undefined) return undefined;
    const tags = [
      ...stored.tags,
      ...(ctx?.tags ?? []),
      ...(ctx?.softTags ?? []),
      ...headerTags(stored.value),
    ];
    // Only the tags this entry carries are asked about, so a hit costs at
    // most one ledger read, and none while their answers are fresh.
    await refreshTagExpiries(tags);
    if (isEntryExpired(tags, stored.begunAt)) {
      entries().deleteIf(key, stored);
      return undefined;
    }
    return stored;
  }

  /**
   * What the build wrote for `key`, kept here as an entry this process stored,
   * or `undefined`. Judged from when the build wrote it, so a write anywhere
   * since expires it as it expires any entry stored before the write.
   */
  private async storedFromBuild(
    key: string,
    ctx: CacheContext | undefined
  ): Promise<StoredEntry | undefined> {
    const built: BuildOutputEntry | null | undefined = await this.fromBuild?.(
      key,
      ctx?.kind,
      ctx
    );
    if (!built) return undefined;
    // A build copy naming a content tag is served only once what expired
    // since the build can be asked: before the ledger is published, a write
    // another process recorded would go unseen, and the stale page could be
    // kept by a shared cache too. A render on a miss waits for the start as it
    // always has. A copy carrying only its path tags read nothing tagged, so
    // it is served at once; every later read asks about those tags as well.
    const contentTags = [
      ...headerTags(built.value),
      ...(ctx?.tags ?? []),
    ].filter(tag => !tag.startsWith(NEXT_IMPLICIT_TAG_PREFIX));
    if (contentTags.length > 0 && !(await expiriesCanBeAsked())) {
      return undefined;
    }
    // A page stored while the disk was read is newer than the build's copy
    // (a regeneration another request finished first), so it stands.
    const storedMeanwhile = entries().get(key);
    if (storedMeanwhile !== undefined) return storedMeanwhile;
    const entry: StoredEntry = {
      value: built.value,
      lastModified: built.lastModified,
      begunAt: built.lastModified,
      tags: [],
      cacheControl: built.cacheControl ?? ctx?.cacheControl,
    };
    entries().set(key, entry, sizeOf(built.value));
    return entry;
  }

  // Synchronous work behind the promise Next.js expects from a handler.
  set(key: string, data: unknown, ctx?: CacheContext): Promise<void> {
    // `null` is a value: a not-found response, cached like any other so the
    // route is not run again on every request.
    if (data === undefined) {
      entries().delete(key);
    } else {
      entries().set(
        key,
        {
          value: data,
          lastModified: Date.now(),
          begunAt: fillBegan(key),
          tags: ctx?.tags ?? [],
          cacheControl: ctx?.cacheControl,
        },
        sizeOf(data)
      );
    }
    return Promise.resolve();
  }

  async revalidateTag(tags: string | string[]): Promise<void> {
    const expired = Array.isArray(tags) ? tags : [tags];
    // A refused record is retried, by the next flush and by a timer. No table
    // is not: every request would expire the tags again, and until the
    // migration runs no instance shares expiries to miss.
    if ((await expireTags(expired)) === "failed") holdFailedRecord(expired);
  }

  // No `resetRequestCache`: this handler keeps no per-request state, and
  // Next.js calls that method only when a handler has one.
}
