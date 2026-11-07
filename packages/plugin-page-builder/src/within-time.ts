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
 * `read`'s answer, or a rejection with what `late` returns once `ms` pass
 * without one.
 */
export function withinTime<T>(
  read: Promise<T>,
  ms: number,
  late: () => Error
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      // The caller's own refusal, so it is told apart from a failed read.
      reject(late());
    }, ms);
  });
  return Promise.race([read, expired]).finally(() => clearTimeout(timer));
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
