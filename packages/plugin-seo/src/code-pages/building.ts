/**
 * Whether this process is `next build` rendering the site's own pages: what
 * Next.js sets while it builds, read the one way every part of the plugin
 * reads it.
 *
 * @module code-pages/building
 */

/** Whether this is `next build` rendering the site's own pages. */
export const isNextBuild = (): boolean =>
  process.env.NEXT_PHASE === "phase-production-build";
