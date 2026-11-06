/**
 * The paths a public catch-all route builds ahead of time.
 *
 * @module lib/static-params
 */

/**
 * Every path the route's `generateStaticParams` names, or the route's root
 * when it names none.
 *
 * Never empty, because Cache Components refuses an exported
 * `generateStaticParams` that names no path, and a fresh install has no
 * published entry. The root then renders the not-found page, as it would on
 * request. A build against a database that cannot answer yet (a fresh one,
 * before its plugins are installed) builds the root alone, as an empty one
 * does.
 */
export async function pathsOrRoot(route: {
  generateStaticParams(): Promise<Array<{ slug: string[] }>>;
}): Promise<Array<{ slug: string[] }>> {
  const params = await route.generateStaticParams().catch(() => []);
  return params.length > 0 ? params : [{ slug: [] }];
}
