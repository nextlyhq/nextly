/**
 * Blog Frontend Layout
 *
 * Wraps all blog pages with Header and Footer, a skip-to-content link
 * for keyboard/screen-reader users, and a `<main>` landmark tagged
 * with `id="main-content"` that the skip link targets.
 *
 * Site settings come from the cached `getSiteSettings` helper so
 * multiple Server Components on the same request share a single fetch.
 */

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getSiteSettings } from "@/lib/queries";

export default async function BlogFrontendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const settings = await getSiteSettings();

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip-to-content — visible only when focused (keyboard tab).
          Lets keyboard and screen-reader users jump past the header
          and navigation directly into the page content. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-neutral-900 focus:px-4 focus:py-2 focus:text-white dark:focus:bg-neutral-100 dark:focus:text-neutral-900"
      >
        Skip to content
      </a>

      <Header siteName={settings.siteName} />
      <main id="main-content" className="flex-1">
        <div className="mx-auto max-w-5xl px-6 py-12">{children}</div>
      </main>
      <Footer siteName={settings.siteName} social={settings.social} />
    </div>
  );
}
