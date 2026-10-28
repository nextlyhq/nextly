/**
 * Static params for an archive route that reads `searchParams` (the category
 * and tag pages, which paginate with `?page=`).
 *
 * Next.js decides at build time whether such a route is static, by rendering
 * the params `generateStaticParams` returns. With none (a site built before it
 * has any categories or tags), it renders nothing, never sees the page read
 * `searchParams`, and treats the route as static. Every archive then renders on
 * its first request, where reading `searchParams` is refused: an unknown
 * archive, and one created after the build, answered 500 rather than a 404 or
 * its posts.
 *
 * So the list is never empty. With no real archives it holds one placeholder,
 * which the build renders: the page reads `searchParams`, which tells Next.js
 * the route is request-time, as it already learns from any real archive. The
 * placeholder is only used when no archive exists, so it shadows none: its
 * page is a 404 at build, and since the route is request-time, an archive
 * created later with that slug renders like any other.
 *
 * At build, the placeholder's render reads nothing from the database (see
 * `isArchivePlaceholder`), so the build depends only on the page's shape, not
 * on what the database holds or whether it can be read at build time.
 */
const PLACEHOLDER_SLUG = "__none__";

export function archiveStaticParams(slugs: string[]): { slug: string }[] {
  return (slugs.length > 0 ? slugs : [PLACEHOLDER_SLUG]).map(slug => ({
    slug,
  }));
}

/** The value Next.js gives `NEXT_PHASE` while `next build` runs. */
const PRODUCTION_BUILD_PHASE = "phase-production-build";

/**
 * Whether this render is the build's placeholder, which reads nothing else.
 * Only during the build: a slug is free text, so a real category or tag may
 * be called `__none__`, and on a request it renders like any other.
 */
export function isArchivePlaceholder(slug: string): boolean {
  return (
    slug === PLACEHOLDER_SLUG &&
    process.env.NEXT_PHASE === PRODUCTION_BUILD_PHASE
  );
}
