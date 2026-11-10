/**
 * What the admin tells search engines: never list it, nor follow its links.
 *
 * One value, read by both places that send it. The app's admin layout
 * exports `adminMetadata` as its Next.js `metadata`, which puts the tag in
 * the head of the first HTML the server sends, before the admin streams in.
 * The admin's own `RootLayout` adds the same tag in the browser only where
 * the page has none, for an app whose layout predates that export.
 *
 * @module domains/admin-metadata
 */

/** The robots directives every admin page carries. */
export const ADMIN_ROBOTS = "noindex, nofollow";

/**
 * The admin layout's Next.js `metadata`:
 * `export const metadata = adminMetadata;` in `app/admin/[[...params]]/layout.tsx`.
 */
export const adminMetadata: { readonly robots: typeof ADMIN_ROBOTS } = {
  robots: ADMIN_ROBOTS,
};
