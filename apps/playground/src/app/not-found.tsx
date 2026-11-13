/**
 * The page for an address nothing on the site answers, worded as Next.js's
 * own.
 *
 * It logs nothing. Next.js renders this page's element on every request, for
 * every page, so a log written from here would count every page view as an
 * address not found. The SEO plugin's log is written where a route decides
 * it has nothing for a request instead: the content routes are handed
 * `notFoundLogged` as their `notFound` (`lib/pages-route.ts`,
 * `lib/block-pages-route.ts`).
 */
export default function NotFound() {
  return (
    <main style={{ padding: "48px 16px", textAlign: "center" }}>
      <h1 style={{ fontSize: 24, fontWeight: 600, margin: 0 }}>404</h1>
      <p style={{ marginTop: 8 }}>This page could not be found.</p>
    </main>
  );
}
