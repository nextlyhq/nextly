/**
 * The start `getNextly()` has begun and not finished, for every entry point
 * that can begin one or must wait for one.
 *
 * A start can be begun by the server's start-up hook, by a request, or by code
 * calling the Direct API, and each must find a start another has begun rather
 * than run a second one. The start-up hook no longer waits for the start it
 * begins, so a request can arrive while it runs: a reader that needs the
 * database waits here for that one start instead of starting again or finding
 * nothing registered.
 *
 * Kept in a module of its own, which imports nothing, so the request path and
 * the Direct API's readers can wait for a start without loading the start
 * itself. On `globalThis`, as the rest of the start's state is, so a start
 * published by one copy of this module is found by another: Next.js and
 * Turbopack can evaluate it in more than one server module graph.
 *
 * @module init/start-in-flight
 */

import type { Nextly } from "./nextly-instance";

const globalForStart = globalThis as unknown as {
  __nextly_initPromise?: Promise<Nextly> | null;
};

/** The start in flight, or null when none is. */
export function startInFlight(): Promise<Nextly> | null {
  return globalForStart.__nextly_initPromise ?? null;
}

/**
 * Publish `start` as the start in flight. Called synchronously by the call
 * that begins it, so a caller arriving at any later point finds it.
 */
export function publishStart(start: Promise<Nextly>): void {
  globalForStart.__nextly_initPromise = start;
}

/** Clear the start in flight, once it has finished either way. */
export function clearStart(): void {
  globalForStart.__nextly_initPromise = null;
}

/**
 * Wait until no start is in flight. Resolves at once when none is, and never
 * rejects: a caller whose start failed meets that failure on its own way in,
 * through the services it then finds unregistered, rather than here. Waits
 * again when another start has begun meanwhile (a retry after a failure), so
 * it returns only once the starts have settled.
 */
export async function awaitStartInFlight(): Promise<void> {
  for (let start = startInFlight(); start; start = startInFlight()) {
    await start.then(
      () => undefined,
      () => undefined
    );
    // A start clears itself in its own `finally`, before it settles, so the
    // loop never waits on the same start twice; this guard keeps it so even
    // if that order changes.
    if (startInFlight() === start) return;
  }
}
