/**
 * Where a cache expiry goes when the request that made the write could not
 * complete it.
 *
 * A write is committed before its cache tags are expired, so a failed expiry
 * never undoes the write. The revalidator retries each failed tag once, then
 * hands what still failed to the {@link ExpiryHandoff}, whose job is to expire
 * those tags from outside the request. Until an out-of-request path is
 * installed, the default keeps the tags in this process, and the next flush in
 * this process expires them before its own: a later request is the earliest
 * moment they can go. There is no timer, on purpose. A timer fires outside any
 * request, where Next.js refuses to expire a tag at all, so it could only ever
 * fail; the out-of-request path that replaces this default is what can.
 *
 * @module revalidation/expiry-handoff
 */
import { consoleLogger } from "../shared/types";

/** Takes tags a request could not expire, to expire them from outside it. */
export interface ExpiryHandoff {
  handOff(tags: string[], reason: string): void | Promise<void>;
}

/**
 * The most tags the default keeps. Past it, a hand-off is logged and dropped:
 * an unbounded set would grow with every write while nothing drains it.
 */
const MAX_PENDING_TAGS = 10_000;

// Whether a drop at the cap was logged already: one line says the cap was
// reached, and a run of writes past it would repeat it on every one.
let dropLogged = false;

/**
 * The default: keeps handed-off tags, deduplicated, for an out-of-request path
 * to drain with {@link takePendingExpiries}.
 */
/**
 * Marks the in-process default, under a key every copy of this module shares.
 * A bundled or hot-reloaded copy has its own class, so `instanceof` asked by
 * one copy misses an instance another made, and the tags it holds would never
 * be drained.
 */
const PENDING_BRAND = Symbol.for("nextly/PendingExpiryHandoff");

/** Whether `handoff` is the in-process default, whichever copy of this module made it. */
export function isPendingExpiryHandoff(
  handoff: unknown
): handoff is { take(): string[] } {
  return (
    typeof handoff === "object" &&
    handoff !== null &&
    (handoff as Record<symbol, unknown>)[PENDING_BRAND] === true &&
    typeof (handoff as { take?: unknown }).take === "function"
  );
}

export class PendingExpiryHandoff implements ExpiryHandoff {
  readonly [PENDING_BRAND] = true;

  private readonly pending = new Set<string>();

  // The revalidator logs each hand-off with its tags and reason, whichever
  // hand-off is installed, so this one only keeps them.
  handOff(tags: string[], _reason: string): void {
    let dropped = 0;
    for (const tag of tags) {
      if (this.pending.size >= MAX_PENDING_TAGS && !this.pending.has(tag)) {
        dropped++;
        continue;
      }
      this.pending.add(tag);
    }
    if (dropped > 0 && !dropLogged) {
      dropLogged = true;
      consoleLogger.error(
        `[nextly] ${MAX_PENDING_TAGS} cache expiries are already waiting; dropped ${dropped} more`
      );
    }
  }

  /** The tags waiting, removed from the set as they are returned. */
  take(): string[] {
    const tags = [...this.pending];
    this.pending.clear();
    return tags;
  }
}

// One per process, across module copies, like the default revalidator factory:
// a hand-off made through one copy of this module must be drained by another.
const globalForHandoff = globalThis as unknown as {
  __nextly_expiry_handoff?: ExpiryHandoff;
};

/** The installed hand-off, or the in-process default. */
export function expiryHandoff(): ExpiryHandoff {
  globalForHandoff.__nextly_expiry_handoff ??= new PendingExpiryHandoff();
  return globalForHandoff.__nextly_expiry_handoff;
}

/** Installs the out-of-request path; `null` restores the in-process default. */
export function setExpiryHandoff(handoff: ExpiryHandoff | null): void {
  globalForHandoff.__nextly_expiry_handoff = handoff ?? undefined;
}

/**
 * Tags an installed hand-off refused, or did not take in time. Kept in this
 * process whichever hand-off is installed, so they are not lost with it: the
 * next flush drains them.
 */
const globalForFallback = globalThis as unknown as {
  __nextly_expiry_fallback?: PendingExpiryHandoff;
};

/** Keeps tags a hand-off failed to take, for the next flush in this process. */
export function holdForNextFlush(tags: string[]): void {
  globalForFallback.__nextly_expiry_fallback ??= new PendingExpiryHandoff();
  globalForFallback.__nextly_expiry_fallback.handOff(tags, "");
}

/**
 * The tags this process holds, drained: the in-process default's, and those an
 * installed hand-off failed to take.
 */
export function takePendingExpiries(): string[] {
  const handoff = expiryHandoff();
  const held = isPendingExpiryHandoff(handoff) ? handoff.take() : [];
  const refused = globalForFallback.__nextly_expiry_fallback?.take() ?? [];
  return [...new Set([...held, ...refused])];
}
