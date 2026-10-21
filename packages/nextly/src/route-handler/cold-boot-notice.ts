import { isNextlyStartInFlight } from "../init";
import { consoleLogger } from "../shared/types";

/**
 * What a developer is told when a request, not a start, booted Nextly.
 *
 * Two situations reach the request-path boot with nothing registered, and
 * only one of them is the reader's problem. A project with no start at its
 * server's start pays per-worker introspection and seeding on first traffic,
 * and the file advice is for it. A project whose start is already under way —
 * the instrumentation `register()` has called Nextly and has not finished —
 * pays nothing extra: its start folds that work into one warmup, and the
 * request simply arrived inside it, the same race the health route waits out.
 *
 * The notice therefore reports what this process observed, never an absence
 * it inferred: no filesystem check says whether `instrumentation.ts` exists,
 * because a file can exist unimported, under the wrong export name, or in a
 * worker that has not reached it — and a start can be loading, not yet
 * visible, when the request arrives. The add-the-file advice stays
 * conditional guidance for a project with no such start, and the wording
 * never claims the file was missing.
 */
export function warnColdBootNotice(): void {
  // Gate on `=== "development"` (not `!== "production"`) to match
  // boot-apply.ts and to avoid polluting `test` runs and staging logs
  // where the audience can't take action on the warning.
  if (
    process.env.NODE_ENV !== "development" ||
    // eslint-disable-next-line turbo/no-undeclared-env-vars
    process.env.NEXTLY_DISABLE_INSTRUMENTATION_WARNING === "1"
  ) {
    return;
  }

  if (isNextlyStartInFlight()) {
    consoleLogger.warn(
      "[nextly] Cold-boot triggered by an incoming request that arrived " +
        "before Nextly finished starting — a start was already under way in " +
        "this process, and this request continues once it has. Nothing is " +
        "missing: that start folds schema introspection and permission " +
        "seeding into a single worker warmup."
    );
    return;
  }

  consoleLogger.warn(
    "[nextly] Cold-boot triggered by an incoming request — no start was " +
      "observed in this process when the request booted Nextly. If nothing " +
      "starts Nextly when your server starts, an `instrumentation.ts` at " +
      "your project root (see " +
      "https://nextly.dev/docs/getting-started/instrumentation) runs schema " +
      "introspection and permission seeding once per worker warmup instead " +
      "of on first traffic; a project that does start Nextly at server " +
      "start can still read this when its request simply arrived first, and " +
      "then no file is missing. Suppress with " +
      "NEXTLY_DISABLE_INSTRUMENTATION_WARNING=1."
  );
}
