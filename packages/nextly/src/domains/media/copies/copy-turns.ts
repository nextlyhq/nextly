/**
 * How copies of stored images take turns being made, within one process.
 *
 * Making a copy decodes its original, at about four bytes a pixel, while
 * someone waits for it. So the work is bounded, and an ask past any bound is
 * answered with the original, which every browser can show:
 *
 * - at most {@link MAKING_AT_ONCE} copies are made at once;
 * - at most {@link WAITING_AT_MOST} more wait their turn, so a burst of new
 *   images, or a caller walking every width, holds a few requests open
 *   rather than an ever-longer queue;
 * - at most {@link SHARING_AT_MOST} asks wait on one copy being made, the
 *   first ask among them;
 * - copies of one original are made one after another
 *   ({@link oneAtATimeFor}), so what one learns of the original, that it is
 *   past the read cap or cannot be resized, reaches the next before it reads
 *   the original again.
 *
 * A copy that could not be kept is not tried again for
 * {@link NOT_AGAIN_FOR_MS}: until then it is answered with the original
 * straight away, rather than each ask paying for another read and resize.
 *
 * @module domains/media/copies/copy-turns
 */

/**
 * How many copies one process makes at once. Two decodes of an original at
 * the pixel limit take a few hundred megabytes between them.
 */
export const MAKING_AT_ONCE = 2;

/**
 * How many different copies wait for a turn. A copy takes a fraction of a
 * second to make, so the last of sixteen waits a few seconds, about what a
 * first view of a page with that many new images can bear. A waiting copy
 * has read nothing yet, so it holds only its request open.
 */
export const WAITING_AT_MOST = 16;

/**
 * How many asks wait on one copy being made. Sharing costs no resize, but
 * each ask is a request held open, and a page shows one image in only a few
 * places at once.
 */
export const SHARING_AT_MOST = 8;

/**
 * How long a copy that could not be kept is answered with the original
 * without being tried again: long enough that a storage refusing writes, or
 * an original that cannot be resized, costs one attempt a minute, and short
 * enough that a fault put right is soon reflected.
 */
export const NOT_AGAIN_FOR_MS = 60_000;

/**
 * The most copies remembered as not to be tried again. The oldest go first
 * past it: forgetting one early costs a single attempt more.
 */
export const REMEMBERED_AT_MOST = 1000;

let making = 0;
const waiting: Array<() => void> = [];

/** Copies being made now, by key, with how many asks wait on each. */
const running = new Map<string, { result: Promise<unknown>; asks: number }>();

/** When each copy that could not be kept may be tried again, by key. */
const notAgainUntil = new Map<string, number>();

/** The last work queued for each original, by the original's key. */
const lastFor = new Map<string, Promise<void>>();

/**
 * Run `work` once every work queued before it for the same `original` is
 * done. Run inside a turn, so a copy waiting here holds its turn: copies of
 * one original are made one after another, never side by side, and the
 * bounds on turns and waiting are counted as before.
 */
export async function oneAtATimeFor<T>(
  original: string,
  work: () => Promise<T>
): Promise<T> {
  const before = lastFor.get(original) ?? Promise.resolve();
  let finished = () => {};
  const mine = new Promise<void>(resolve => {
    finished = resolve;
  });
  const last = before.then(() => mine);
  lastFor.set(original, last);
  await before;
  try {
    return await work();
  } finally {
    finished();
    if (lastFor.get(original) === last) lastFor.delete(original);
  }
}

/** Run `work` once fewer than {@link MAKING_AT_ONCE} copies are being made. */
async function inTurn<T>(work: () => Promise<T>): Promise<T> {
  if (making >= MAKING_AT_ONCE) {
    // Woken holding the slot the copy before it gave up, so no ask arriving
    // in between can take it too.
    await new Promise<void>(resolve => waiting.push(resolve));
  } else {
    making += 1;
  }
  try {
    return await work();
  } finally {
    // The slot passes straight to the next waiting copy, or is freed.
    const next = waiting.shift();
    if (next) next();
    else making -= 1;
  }
}

/**
 * The copy at `key`: shared with the ask already making it, or made by
 * `make` in its turn. `undefined` when the bounds leave no room for this ask,
 * and the caller serves the original.
 */
export function copyInTurn<T>(
  key: string,
  make: () => Promise<T>
): Promise<T> | undefined {
  const current = running.get(key);
  if (current) {
    if (current.asks >= SHARING_AT_MOST) return undefined;
    current.asks += 1;
    return current.result as Promise<T>;
  }
  // Checked and joined in one step: `inTurn` queues before its first await.
  if (making >= MAKING_AT_ONCE && waiting.length >= WAITING_AT_MOST) {
    return undefined;
  }
  const result = inTurn(make).finally(() => running.delete(key));
  running.set(key, { result, asks: 1 });
  return result;
}

/** Whether the copy at `key` is, for now, answered with the original. */
export function notTriedAgainYet(key: string): boolean {
  const until = notAgainUntil.get(key);
  if (until === undefined) return false;
  if (Date.now() < until) return true;
  notAgainUntil.delete(key);
  return false;
}

/** Answer the copy at `key` with the original for {@link NOT_AGAIN_FOR_MS}. */
export function notAgainForAWhile(key: string): void {
  // Moved to the end, so the oldest is always first.
  notAgainUntil.delete(key);
  notAgainUntil.set(key, Date.now() + NOT_AGAIN_FOR_MS);
  while (notAgainUntil.size > REMEMBERED_AT_MOST) {
    const oldest = notAgainUntil.keys().next();
    if (oldest.done) break;
    notAgainUntil.delete(oldest.value);
  }
}

/** Forget every copy being made and every one remembered. For tests. */
export function resetCopyTurnsForTests(): void {
  making = 0;
  waiting.length = 0;
  running.clear();
  notAgainUntil.clear();
  lastFor.clear();
}
