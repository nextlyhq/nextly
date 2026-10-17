/**
 * Counting for auth requests whose client address cannot be resolved.
 *
 * A Web `Request` carries no peer address, so without a trusted proxy no
 * client address resolves at all. Counting every such request in one bucket
 * let thirty requests from anyone refuse sign-in to everyone. Here each
 * request is counted against the account it names instead, at the configured
 * per-address budget, and every admission also spends one shared ceiling, so
 * rotating invented names buys no capacity of its own.
 *
 * The rules a counter keeps, whichever backs it:
 *
 * - A request its budget refuses spends nothing on the ceiling.
 * - A request the ceiling refuses spends nothing anywhere and creates no
 *   bucket, so a met ceiling neither extends a window nor seeds the next one.
 * - The one exception is a request whose account comes from a token: telling
 *   which account costs a lookup, and the ceiling is what bounds that work, so
 *   such a request spends the ceiling on arrival ({@link UnknownSourceCounter.arrive}).
 *
 * @module auth/middleware/unknown-source-counter
 */

import type { RateLimiter } from "./rate-limiter";

/** The numbers a decision is made against. */
export interface UnknownSourceLimits {
  /** Admissions one key may have within the window. */
  budget: number;
  /** Admissions every key together may have within the window. */
  ceiling: number;
  windowMs: number;
}

/** A counter's answer. */
export type UnknownSourceVerdict =
  | { allowed: true }
  | {
      allowed: false;
      /** Which limit refused: the key's own budget, or the shared ceiling. */
      by: "budget" | "ceiling";
      /** When, in ms since the epoch, the refusing window slides. */
      resetAt: number;
    };

/** A token request's place in the ceiling, or its refusal. */
export type UnknownSourceArrival =
  | { allowed: true; at: number }
  | Extract<UnknownSourceVerdict, { allowed: false }>;

/** Where unknown-source admissions are counted. */
export interface UnknownSourceCounter {
  /**
   * The ceiling's refusal when it is already met, or `null`, recording
   * nothing. A cheap answer asked before any work a request costs, such as
   * reading its body; `null` where the store cannot say without recording,
   * and the admission that follows still decides.
   */
  ceilingMet(
    limits: UnknownSourceLimits
  ): Promise<Extract<UnknownSourceVerdict, { allowed: false }> | null>;
  /** Admit against `key`'s budget and the ceiling together. */
  admit(
    key: string,
    limits: UnknownSourceLimits
  ): Promise<UnknownSourceVerdict>;
  /** Spend one place in the ceiling before a token is looked up. */
  arrive(limits: UnknownSourceLimits): Promise<UnknownSourceArrival>;
  /** Admit against `key`'s budget alone, for a request that arrived at `at`. */
  admitArrived(
    key: string,
    limits: UnknownSourceLimits,
    at: number
  ): Promise<UnknownSourceVerdict>;
}

/** The ceiling's key, apart from every per-account key. */
export const UNKNOWN_SOURCE_CEILING_KEY = "auth-unknown:ceiling";

function refused(
  by: "budget" | "ceiling",
  resetAt: number
): Extract<UnknownSourceVerdict, { allowed: false }> {
  return { allowed: false, by, resetAt };
}

/** Insert `at` keeping `times` ascending, so `times[0]` stays the oldest. */
function insertInOrder(times: number[], at: number): void {
  let index = times.length;
  while (index > 0 && (times[index - 1] ?? 0) > at) index--;
  times.splice(index, 0, at);
}

/**
 * The counter kept in this process: the default, where no store is
 * configured.
 *
 * Each decision runs to completion in one synchronous step, so the ceiling and
 * a key's budget are judged and recorded together with nothing in between.
 *
 * **Its size is bounded by the ceiling.** Every entry a key holds is stamped
 * with the time of the ceiling entry its admission spent, so the two expire
 * together and the keys holding live entries can never outnumber the
 * ceiling's live entries. With room for as many keys as the ceiling admits,
 * a key is turned away for want of room only once the ceiling is met; until
 * then a key whose entries have all expired can always be retired to make
 * room. A key with live entries is never retired: dropping an exhausted one
 * would hand its budget back under exactly the flood the bound exists for.
 */
export class MemoryUnknownSourceCounter implements UnknownSourceCounter {
  private readonly buckets = new Map<string, number[]>();
  private ceilingEntries: number[] = [];

  /** Keys currently tracked. For tests and monitoring only. */
  get trackedKeys(): number {
    return this.buckets.size;
  }

  ceilingMet(
    limits: UnknownSourceLimits
  ): Promise<Extract<UnknownSourceVerdict, { allowed: false }> | null> {
    return Promise.resolve(this.ceilingRefusal(Date.now(), limits));
  }

  admit(
    key: string,
    limits: UnknownSourceLimits
  ): Promise<UnknownSourceVerdict> {
    const now = Date.now();
    const full = this.ceilingRefusal(now, limits);
    if (full) return Promise.resolve(full);
    return Promise.resolve(this.record(key, limits, now, now, true));
  }

  arrive(limits: UnknownSourceLimits): Promise<UnknownSourceArrival> {
    const now = Date.now();
    const full = this.ceilingRefusal(now, limits);
    if (full) return Promise.resolve(full);
    insertInOrder(this.ceilingEntries, now);
    return Promise.resolve({ allowed: true, at: now });
  }

  admitArrived(
    key: string,
    limits: UnknownSourceLimits,
    at: number
  ): Promise<UnknownSourceVerdict> {
    return Promise.resolve(this.record(key, limits, Date.now(), at, false));
  }

  /** The ceiling's refusal when it is met; nothing else is touched. */
  private ceilingRefusal(
    now: number,
    limits: UnknownSourceLimits
  ): Extract<UnknownSourceVerdict, { allowed: false }> | null {
    const since = now - limits.windowMs;
    // Dropping the ceiling's own expired entries is how its window slides;
    // it changes no key's bucket.
    this.ceilingEntries = this.ceilingEntries.filter(t => t > since);
    if (this.ceilingEntries.length < limits.ceiling) return null;
    return refused(
      "ceiling",
      (this.ceilingEntries[0] ?? now) + limits.windowMs
    );
  }

  /**
   * Judge `key` against its budget and record an admission at `at`, with the
   * ceiling entry as well when `spendCeiling` (it was already spent on
   * arrival otherwise).
   */
  private record(
    key: string,
    limits: UnknownSourceLimits,
    now: number,
    at: number,
    spendCeiling: boolean
  ): UnknownSourceVerdict {
    const since = now - limits.windowMs;
    const live = (this.buckets.get(key) ?? []).filter(t => t > since);
    if (live.length >= limits.budget) {
      return refused("budget", (live[0] ?? now) + limits.windowMs);
    }
    if (!this.buckets.has(key) && !this.makeRoom(since, limits.ceiling)) {
      // Unreachable before the ceiling is met (see the class note), and
      // cheap to keep: the answer is the ceiling's, as the sizing promises.
      return refused(
        "ceiling",
        (this.ceilingEntries[0] ?? now) + limits.windowMs
      );
    }
    insertInOrder(live, at);
    this.buckets.set(key, live);
    if (spendCeiling) insertInOrder(this.ceilingEntries, at);
    return { allowed: true };
  }

  /** Whether a new key fits, retiring keys with no live entry if needed. */
  private makeRoom(since: number, bound: number): boolean {
    if (this.buckets.size < bound) return true;
    for (const [key, times] of this.buckets) {
      if (!times.some(t => t > since)) this.buckets.delete(key);
    }
    return this.buckets.size < bound;
  }
}

/**
 * The counter over an app's own store of the `RateLimitStore` contract, which
 * every instance may share.
 *
 * That contract decides one key at a time, so the ceiling and a key's budget
 * cannot be judged in one step here. The order keeps every rule but one, and
 * creates a key only for a request the ceiling admitted: the key's budget is
 * read first without recording, so a request it refuses spends nothing; the
 * ceiling is spent next, so a met ceiling refuses before any key exists, and
 * a burst of fresh addresses past it leaves nothing in the store; the key's
 * budget is spent last. Two requests for the SAME key can both pass the read
 * while one budget place is left, and the one that then loses has spent a
 * ceiling place: one place too many, never too few, and no new key. Keeping
 * the window in the operator's shared store is worth that, since a
 * per-process count would multiply every budget by the number of instances.
 *
 * A store without `consume` can count only by recording, so the ceiling cannot
 * be read without being spent. There the ceiling is spent FIRST, and a met
 * ceiling refuses before the key is touched: otherwise every fresh address
 * offered past the ceiling would still create a key in the store, and the
 * ceiling would bound nothing about the store's size. The price is the one
 * such stores already pay ({@link RateLimiter.check}): every attempt counts,
 * refusals included, so a request its own budget refuses has spent the
 * ceiling too. Stricter, never looser. How long keys are kept is the store's
 * own concern.
 */
export class StoreUnknownSourceCounter implements UnknownSourceCounter {
  constructor(private readonly limiter: RateLimiter) {}

  async ceilingMet(
    limits: UnknownSourceLimits
  ): Promise<Extract<UnknownSourceVerdict, { allowed: false }> | null> {
    const held = await this.limiter.window(
      UNKNOWN_SOURCE_CEILING_KEY,
      limits.windowMs
    );
    return held && held.count >= limits.ceiling
      ? refused("ceiling", held.resetAt.getTime())
      : null;
  }

  async admit(
    key: string,
    limits: UnknownSourceLimits
  ): Promise<UnknownSourceVerdict> {
    const held = await this.limiter.window(
      UNKNOWN_SOURCE_CEILING_KEY,
      limits.windowMs
    );
    if (held === undefined) {
      const ceiling = await this.spendCeiling(limits);
      if (!ceiling.allowed) return ceiling;
      return this.admitArrived(key, limits);
    }
    if (held.count >= limits.ceiling) {
      return refused("ceiling", held.resetAt.getTime());
    }
    const own = await this.limiter.window(key, limits.windowMs);
    if (own && own.count >= limits.budget) {
      return refused("budget", own.resetAt.getTime());
    }
    const ceiling = await this.spendCeiling(limits);
    if (!ceiling.allowed) return ceiling;
    return this.admitArrived(key, limits);
  }

  async arrive(limits: UnknownSourceLimits): Promise<UnknownSourceArrival> {
    const verdict = await this.spendCeiling(limits);
    return verdict.allowed ? { allowed: true, at: Date.now() } : verdict;
  }

  async admitArrived(
    key: string,
    limits: UnknownSourceLimits
  ): Promise<UnknownSourceVerdict> {
    const own = await this.limiter.check(key, limits.budget, limits.windowMs);
    return own.allowed
      ? { allowed: true }
      : refused("budget", own.resetAt.getTime());
  }

  private async spendCeiling(
    limits: UnknownSourceLimits
  ): Promise<UnknownSourceVerdict> {
    const spent = await this.limiter.check(
      UNKNOWN_SOURCE_CEILING_KEY,
      limits.ceiling,
      limits.windowMs
    );
    return spent.allowed
      ? { allowed: true }
      : refused("ceiling", spent.resetAt.getTime());
  }
}

/**
 * The process-local counter, used when no store is configured. One per
 * process, like the limiter's own default window map.
 */
export const memoryUnknownSourceCounter = new MemoryUnknownSourceCounter();
