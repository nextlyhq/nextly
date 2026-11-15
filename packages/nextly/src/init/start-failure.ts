/**
 * The errors Nextly's start rejected with, so code that reads them later can
 * tell "Nextly could not be started" from any other failure without matching
 * a message.
 *
 * A start fails for reasons a reader cannot classify by shape: a driver's own
 * error for a host that refuses connections, a migration the database could
 * not run, a timeout with no code. What they share is where they came from,
 * so `getCachedNextly` records each error its start rejected with here, and
 * the render policy (`errors/unavailable`) reads the record. A read that
 * found nothing to start is not recorded: no start was made, so nothing about
 * Nextly's availability is known from it.
 *
 * Kept in a module of its own, which imports nothing, so the policy can read
 * the record without loading the start. On `globalThis`, as the rest of the
 * start's state is, so an error recorded by one copy of this module is found
 * by another: Next.js and Turbopack can evaluate it in more than one server
 * module graph. A `WeakSet`, so a recorded error is never kept alive by it.
 *
 * @module init/start-failure
 */

const globalForStartFailures = globalThis as unknown as {
  __nextly_startFailures?: WeakSet<object>;
};

/** The record, made on first use. */
function startFailures(): WeakSet<object> {
  globalForStartFailures.__nextly_startFailures ??= new WeakSet();
  return globalForStartFailures.__nextly_startFailures;
}

/**
 * Record `error` as one Nextly's start rejected with. A thrown value that is
 * not an object cannot be recorded (`getCachedNextly` makes one an error
 * first). An error carrying a `digest` is Next.js's own, such as the signal a
 * dynamic API throws while a page prerenders: it says nothing about Nextly,
 * and is never recorded, so it reaches Next.js as it was thrown.
 */
export function markStartFailure(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  if ("digest" in error && typeof error.digest === "string") return;
  startFailures().add(error);
}

/** Whether `error` is one Nextly's start rejected with. */
export function isStartFailure(error: unknown): boolean {
  return (
    typeof error === "object" && error !== null && startFailures().has(error)
  );
}
