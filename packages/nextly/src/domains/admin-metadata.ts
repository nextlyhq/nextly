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

/**
 * The id of the element the admin layout carries the configured branding in,
 * and the admin reads it from before any request answers.
 */
export const ADMIN_BRANDING_ELEMENT_ID = "nextly-admin-branding";

/** The branding keys the prebuilt admin page carries, as the config names them. */
const PAGE_BRANDING_KEYS = [
  "logoUrl",
  "logoUrlLight",
  "logoUrlDark",
  "logoText",
  "favicon",
] as const;

/** The part of the config's `admin.branding` the page carries. */
export type AdminPageBranding = Partial<
  Record<(typeof PAGE_BRANDING_KEYS)[number], string>
>;

/**
 * The configured branding as the JSON the admin layout writes into the page
 * (`<script type="application/json" id="nextly-admin-branding">`), so the
 * logo and name are right from the first paint and the page never waits on
 * the database for them. Only the keys set to a non-empty string travel; the
 * colours go through `getBrandingCss`. `null` when nothing is configured.
 *
 * Every `<` is written as `\u003c`, so a value holding `</script>` cannot
 * end the element early: the JSON still parses to the same strings.
 */
export function adminBrandingJson(
  branding: AdminPageBranding | undefined
): string | null {
  const carried: AdminPageBranding = {};
  for (const key of PAGE_BRANDING_KEYS) {
    const value = branding?.[key];
    if (typeof value === "string" && value.trim() !== "") carried[key] = value;
  }
  if (Object.keys(carried).length === 0) return null;
  return JSON.stringify(carried).replace(/</g, "\\u003c");
}

/**
 * The admin layout's Next.js `metadata` for the app's configured branding:
 * the robots directives every admin page carries and, when a favicon is set,
 * its icon link, so the first HTML already holds it and the admin never has
 * to swap one in. `export const metadata = adminMetadataFor(config.admin?.branding);`
 */
export function adminMetadataFor(branding: AdminPageBranding | undefined): {
  readonly robots: typeof ADMIN_ROBOTS;
  readonly icons?: { readonly icon: string };
} {
  const favicon = branding?.favicon?.trim();
  return favicon
    ? { ...adminMetadata, icons: { icon: favicon } }
    : adminMetadata;
}
