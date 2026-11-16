/**
 * One load per key at a time: a caller asking for a key whose load is under
 * way is handed that load rather than starting another.
 *
 * Concurrent requests that each miss the same cached value would otherwise
 * each read it: sixteen requests of one admin screen arriving as a kept value
 * lapses send sixteen identical reads where one answers them all. This is the
 * one implementation of that sharing; a cache that needs it keeps a map of
 * the loads under way and loads through here.
 *
 * - **Every waiter gets the same outcome.** A load that fails rejects every
 *   caller that joined it, so none of them treats a failed read as an answer.
 * - **A failure is never kept.** The load leaves the map once it settles, so
 *   the next caller after a failure loads again.
 * - **Nothing ties the load to one caller.** It takes no abort signal: a load
 *   others have joined runs to its end whatever happens to the caller that
 *   started it.
 * - **Only one process.** The map is in memory; another instance shares
 *   nothing with this one.
 *
 * The caller decides the key, and with it what may be shared: a load whose
 * answer depends on a version that can move keys on that version, so a caller
 * arriving after a change never joins a load begun before it.
 *
 * @module shared/lib/coalesce
 */

/**
 * The load under way for `key` in `inFlight`, or `load()` started now and
 * shared with every caller that asks for `key` until it settles.
 */
export function coalesce<K, T>(
  inFlight: Map<K, Promise<T>>,
  key: K,
  load: () => Promise<T>
): Promise<T> {
  const running = inFlight.get(key);
  if (running !== undefined) return running;
  // Called at once, so the load is under way before this returns, and a
  // load that throws rather than rejecting is a rejection like any other.
  const started = (async () => load())();
  const shared = started.finally(() => {
    if (inFlight.get(key) === shared) inFlight.delete(key);
  });
  inFlight.set(key, shared);
  return shared;
}
