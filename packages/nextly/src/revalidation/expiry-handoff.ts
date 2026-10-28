/**
 * Where a cache expiry goes when the request that made the write could not
 * complete it.
 *
 * A write is committed before its cache tags are expired, so a failed expiry
 * never undoes the write. The revalidator retries each failed tag once, then
 * hands what still failed to the {@link ExpiryHandoff}, whose job is to expire
 * those tags from outside the request. Until an out-of-request path is
 * installed, the default keeps the tags in this process, so they can be drained
 * by one.
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

/**
 * The default: keeps handed-off tags, deduplicated, for an out-of-request path
 * to drain with {@link takePendingExpiries}.
 */
export class PendingExpiryHandoff implements ExpiryHandoff {
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
    if (dropped > 0) {
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

/** The tags the in-process default holds, drained. Empty when another hand-off is installed. */
export function takePendingExpiries(): string[] {
  const handoff = expiryHandoff();
  return handoff instanceof PendingExpiryHandoff ? handoff.take() : [];
}
