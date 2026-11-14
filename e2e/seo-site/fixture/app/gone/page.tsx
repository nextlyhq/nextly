/**
 * The site's own page for an address made Gone, named by the plugin's
 * `gonePage` option when `SEO_SITE_GONE_PAGE` is set. Kept out of search.
 */
export const metadata = {
  title: "Retired",
  robots: { index: false },
};

export default function GonePage() {
  return <h1>This page was retired on purpose</h1>;
}
