/**
 * Blog Frontend Layout
 *
 * Wraps all (frontend) route-group pages with the redesigned Header
 * and Footer. Fetches SiteSettings + Navigation once per request
 * (both cached via React cache) and passes them as props so nested
 * pages don't each re-fetch.
 *
 * Ships a skip-to-content link and a `<main id="main-content">` so
 * keyboard and screen-reader users can jump past the header.
 */

import { Footer } from "@/components/Footer";
import { Header } from "@/components/Header";
import { getNavigation } from "@/lib/queries/navigation";
import { getSiteSettings } from "@/lib/queries/site-settings";
import { getAllCategories } from "@/lib/queries/categories";

export default async function BlogFrontendLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [settings, navigation, categories] = await Promise.all([
    getSiteSettings(),
    getNavigation(),
    getAllCategories(),
  ]);

  // Remove the static 'Tags' and 'Categories' links
  const filteredLinks = navigation.headerLinks.filter(
    link =>
      link.label.toLowerCase() !== "tags" &&
      link.label.toLowerCase() !== "categories"
  );

  // Map actual categories into NavLink format
  const categoryLinks = categories.map(cat => ({
    label: cat.name,
    href: `/categories/${cat.slug}`,
  }));

  const enhancedNavigation = {
    ...navigation,
    headerLinks: [...filteredLinks, ...categoryLinks],
  };

  return (
    <div className="flex min-h-screen flex-col">
      {/* Skip-to-content - only visible on keyboard focus. Lets
          keyboard / screen-reader users jump past the header. */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:px-4 focus:py-2 focus:font-medium"
        style={{
          background: "var(--color-fg)",
          color: "var(--color-bg-surface)",
        }}
      >
        Skip to content
      </a>

      <Header
        siteName={settings.siteName}
        logo={settings.logo}
        navigation={enhancedNavigation}
      />
      <main id="main-content" className="flex-1 w-full">
        {children}
      </main>
      <Footer
        siteName={settings.siteName}
        tagline={settings.tagline}
        logo={settings.logo}
        social={settings.social}
        navigation={enhancedNavigation}
      />
    </div>
  );
}
