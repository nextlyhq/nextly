/**
 * Whether the plugin registry has to be filled before it can be asked.
 *
 * Plugin routes are registered during service initialisation, and that is lazy.
 * An app wired through `createDynamicHandlers({ config })` has an empty registry
 * on its first request, so a public plugin route answers 400 until something
 * else happens to boot the app, and a serverless worker repeats that on every
 * cold start.
 *
 * Booting unconditionally is the wrong cure: a request to a path nothing serves
 * would connect the database and run startup work before being refused, which
 * hands an unauthenticated caller a cold start it could not otherwise cause.
 *
 * So the answer is yes only when there is something to boot FOR, which the
 * stored config already says. Pure, and separate from the boot it gates, so the
 * decision can be checked without one.
 *
 * @module plugins/routes/should-register
 */

/** The part of a plugin definition this reads. */
interface RouteContributor {
  contributes?: { routes?: unknown[] };
}

export function shouldRegisterPluginRoutes(
  registeredCount: number,
  plugins: readonly RouteContributor[] | undefined
): boolean {
  // Already filled: every request after the first, which is nearly all of them.
  if (registeredCount > 0) return false;
  // Nothing to fill it with. An app contributing no routes never boots on an
  // unknown path, which is the case the surrounding code is careful about.
  return (plugins ?? []).some(
    plugin => (plugin.contributes?.routes?.length ?? 0) > 0
  );
}
