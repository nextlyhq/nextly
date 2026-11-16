/**
 * The timers a media delete arms to finish its items when their Undo window
 * ends, kept so they stop with the services they finish through.
 *
 * A timer is this process's fast path only: the job each delete queues
 * finishes it durably, and the library's reads sweep what is left. So when the
 * services are released (`clearServices`, `shutdownServices`) every armed
 * timer is cleared rather than left to run through a container that is empty,
 * or that a later registration has filled with its own.
 *
 * @module domains/media/delete-window-timers
 */

interface DeleteWindowTimers {
  /** Set once the services these timers finish through are released. */
  stopped: boolean;
  readonly armed: Set<ReturnType<typeof setTimeout>>;
}

// One per process, across module copies: the route that arms a timer and the
// registration that releases the services may load this module separately.
const globalForDeleteTimers = globalThis as unknown as {
  __nextly_media_delete_timers?: DeleteWindowTimers;
};

/**
 * Run `finish` after `delayMs`, unless the services are released first.
 * `finish` is told whether they have been released since, so a run under way
 * when they are arms no timer for a later registration. Unref'd: a waiting
 * delete never keeps a process alive.
 */
export function afterDeleteWindow(
  delayMs: number,
  finish: (released: () => boolean) => Promise<void>
): void {
  globalForDeleteTimers.__nextly_media_delete_timers ??= {
    stopped: false,
    armed: new Set(),
  };
  const timers = globalForDeleteTimers.__nextly_media_delete_timers;
  const timer = setTimeout(() => {
    timers.armed.delete(timer);
    void finish(() => timers.stopped);
  }, delayMs);
  timer.unref?.();
  timers.armed.add(timer);
}

/**
 * Clear every armed timer, when the services they finish through are
 * released. What they would have finished stays marked, for the queued job
 * and the next library read.
 */
export function stopDeleteWindowTimers(): void {
  const timers = globalForDeleteTimers.__nextly_media_delete_timers;
  if (timers === undefined) return;
  timers.stopped = true;
  for (const timer of timers.armed) clearTimeout(timer);
  timers.armed.clear();
  globalForDeleteTimers.__nextly_media_delete_timers = undefined;
}
