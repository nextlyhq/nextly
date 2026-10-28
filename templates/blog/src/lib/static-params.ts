/**
 * Static params for a detail route (a post, an author, a category, a tag)
 * that are never empty.
 *
 * Two reasons, either of which is enough:
 *
 * - Under Cache Components, Next.js refuses a `generateStaticParams` that
 *   returns nothing, so a site built before it has any posts or authors fails
 *   its build.
 * - An archive route that reads `searchParams` (the category and tag pages,
 *   which paginate with `?page=`) is judged static or request-time by
 *   rendering the params this returns. With none it renders nothing, never
 *   sees the page read `searchParams`, and treats the route as static; every
 *   archive then rendered on its first request, where reading `searchParams`
 *   is refused, and answered 500 rather than a 404 or its posts.
 *
 * So with no real entries the list holds one placeholder, which the build
 * renders as a not-found page. It is only used when no entry exists, so it
 * shadows none, and an entry created later with that slug renders like any
 * other.
 *
 * At build, the placeholder's render reads nothing from the database (see
 * `isBuildPlaceholder`), so the build depends only on the page's shape, not
 * on what the database holds or whether it can be read at build time.
 */
const PLACEHOLDER_SLUG = "__none__";

export function detailStaticParams(slugs: string[]): { slug: string }[] {
  return (slugs.length > 0 ? slugs : [PLACEHOLDER_SLUG]).map(slug => ({
    slug,
  }));
}

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
const PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Whether this render is the build's placeholder, which reads nothing else.
 * Only during the build: a slug is free text, so a real entry may be called
 * `__none__`, and on a request it renders like any other.
 */
export function isBuildPlaceholder(slug: string): boolean {
  return (
    slug === PLACEHOLDER_SLUG &&
    process.env.NEXT_PHASE === PRODUCTION_BUILD_PHASE
  );
}
