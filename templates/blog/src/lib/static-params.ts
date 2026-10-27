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
 */
const PLACEHOLDER_SLUG = "__none__";

export function archiveStaticParams(slugs: string[]): { slug: string }[] {
  return (slugs.length > 0 ? slugs : [PLACEHOLDER_SLUG]).map(slug => ({
    slug,
  }));
}
