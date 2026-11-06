/**
 * The paths a public catch-all route builds ahead of time.
 *
 * @module lib/static-params
 */

/**
 * Whether a read failed because the database has not had the app's plugins
 * installed yet, which is what a fresh database answers at build time: the
 * one failure a build may take as "no entries yet". Looked for along the
 * error's causes, since a route may wrap what the read threw.
 */
function notInstalledYet(error: unknown): boolean {
  for (let at = error, depth = 0; at !== undefined && depth < 5; depth += 1) {
    if (typeof at !== "object" || at === null) return false;
    if ((at as { code?: unknown }).code === "PLUGIN_NOT_INSTALLED") return true;
    at = (at as { cause?: unknown }).cause;
  }
  return false;
}

/**
 * Every path the route's `generateStaticParams` names, or the route's root
 * when it names none.
 *
 * Never empty, because Cache Components refuses an exported
 * `generateStaticParams` that names no path, and a fresh install has no
 * published entry. The root then renders the not-found page, as it would on
 * request. A build against a database that has not had its plugins installed
 * yet builds the root alone, as an empty one does; any other failure fails the
 * build, so a broken read cannot pass for a site with nothing to pre-render.
 */
export async function pathsOrRoot(route: {
  generateStaticParams(): Promise<Array<{ slug: string[] }>>;
}): Promise<Array<{ slug: string[] }>> {
  const params = await route.generateStaticParams().catch((error: unknown) => {
    if (notInstalledYet(error)) return [];
    throw error;
  });
  return params.length > 0 ? params : [{ slug: [] }];
}
