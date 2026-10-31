import { isServerStartRegisterRunning } from "../init";
import { consoleLogger } from "../shared/types";

/**
 * What a developer is told when a request, not a start, booted Nextly.
 *
 * Two situations reach the request-path boot with nothing registered, and
 * only one of them is the reader's problem. A project with no start at its
 * server's start pays per-worker introspection and seeding on first traffic,
 * and the file advice is for it — including when the in-flight boot another
 * request began is request-time `getNextly({ config })`, which folds nothing:
 * only a start whose origin is the project's instrumentation
 * (`createRegister`) counts as a server-start boot. A project whose
 * instrumentation start is actively under way pays nothing extra: the request
 * simply arrived inside it, the same race the health route waits out.
 *
 * The notice therefore reports what this process observed, never an absence
 * it inferred: no filesystem check says whether `instrumentation.ts` exists,
 * because a file can exist unimported, under the wrong export name, or in a
 * worker that has not reached it — and a start can be loading, not yet
 * visible, when the request arrives. The add-the-file advice stays
 * conditional guidance for a project with no such start, and the wording
 * never claims the file was missing — nor, in the other direction, that
 * nothing is: a start observed says only that it was observed.
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

  if (isServerStartRegisterRunning()) {
    consoleLogger.warn(
      "[nextly] Cold-boot triggered by an incoming request that arrived " +
        "before Nextly finished starting — a start was observed under way " +
        "in this process, and this request continues once it has."
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
