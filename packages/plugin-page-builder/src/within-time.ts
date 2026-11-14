/**
 * A read bounded in time: its answer, or the caller's refusal once the time
 * runs out first.
 *
 * Used where a read is made from inside a transaction and could wait on that
 * transaction itself: on PostgreSQL and MySQL a read taken from the pool while
 * the transaction holds a connection waits for a free one, and where the
 * transaction holds the last one it waits for good. A guard that cannot read
 * in time refuses, as one whose read fails does, rather than letting the
 * write it guards through or holding it open.
 *
 * A read that runs out of time is told so through its signal, so one that
 * makes many reads (a walk over every stored document) can stop at the next
 * rather than go on unheard after its caller has answered.
 *
 * @module within-time
 */

/**
 * The longest delay a timer holds: Node fires a longer one (an unbounded
 * box, `Infinity`) after 1 ms instead, which would take the time as spent.
 */
const LONGEST_TIMER_MS = 2_147_483_647;

/** What a read held to a time box answers when the time ran out first. */
export const TIMED_OUT: unique symbol = Symbol("timed out");

/**
 * `read`'s answer, or {@link TIMED_OUT} once `ms` have passed first: the one
 * race every bounded read here runs. The timer is cleared whichever wins, so
 * none outlives the answer, and a read that fails after losing has its
 * failure taken by the race, never left unhandled.
 */
export async function within<T>(
  read: Promise<T>,
  ms: number
): Promise<T | typeof TIMED_OUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<typeof TIMED_OUT>(resolve => {
    const delay = Math.min(Math.max(0, ms), LONGEST_TIMER_MS);
    timer = setTimeout(() => resolve(TIMED_OUT), delay);
  });
  try {
    return await Promise.race([read, expired]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * `read`'s answer, or a rejection with what `late` returns once `ms` pass
 * without one: {@link within}, with running out of time made a failure.
 */
export async function withinTime<T>(
  read: Promise<T>,
  ms: number,
  late: () => Error
): Promise<T> {
  const answer = await within(read, ms);
  // The caller's own refusal, so it is told apart from a failed read.
  if (answer === TIMED_OUT) throw late();
  return answer;
}

/** Why a bounded read was refused: it ran out of time, or it failed. */
export type UnreadReason = "timed-out" | "failed";

/**
 * `read`'s answer within `ms`, or the refusal `refused` makes: for a read that
 * runs out of time and for one that fails alike, so a guard never takes a read
 * it did not get for one that found nothing. `refused` is handed the read's
 * own failure, to keep as the refusal's cause. `read` is handed a signal
 * aborted once the time runs out, to stop reading by.
 */
export async function readWithinOrRefuse<T>(
  read: (signal: AbortSignal) => Promise<T>,
  ms: number,
  refused: (why: UnreadReason, error?: unknown) => Error
): Promise<T> {
  const timedOut = refused("timed-out");
  const stop = new AbortController();
  try {
    return await withinTime(read(stop.signal), ms, () => {
      stop.abort();
      return timedOut;
    });
  } catch (error) {
    if (error === timedOut) throw error;
    throw refused("failed", error);
  }
}
