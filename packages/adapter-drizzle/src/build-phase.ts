/**
 * The one answer to "is this process `next build`?".
 *
 * Next.js boots the app while it builds, to prerender the pages that read
 * content, with `NODE_ENV` set to production and `NEXT_PHASE` set to the
 * build phase. A build may point at a database other deployments share, from
 * a configuration older or newer than theirs, and it serves no request, so
 * Nextly writes nothing there but the seal of a plugin's secret settings.
 *
 * Lives in the adapter package because both sides ask it and neither may
 * import the other: `nextly` skips its own writes in the build, and the
 * adapters skip the ones they make when they connect (SQLite's journal mode,
 * a missing PostgreSQL schema), which an adapter an app constructs itself
 * makes before `nextly` is ever called.
 *
 * @module build-phase
 * @since 1.0.0
 */

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
export const NEXT_PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Whether this process is `next build`.
 *
 * Read from the environment each time it is asked, not once at import: a
 * module loaded before Next.js sets the phase still answers for the build.
 */
export function isNextBuildPhase(
  env: Readonly<Record<string, string | undefined>> = process.env
): boolean {
  return env.NEXT_PHASE === NEXT_PRODUCTION_BUILD_PHASE;
}
