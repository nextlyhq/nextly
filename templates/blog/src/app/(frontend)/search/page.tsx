/**
 * Search Page
 *
 * Dedicated /search route with a client-side Pagefind index. The
 * index is built during `next build` via
 * `scripts/build-search-index.mjs` and served as static assets from
 * `public/pagefind/`.
 */

import type { Metadata } from "next";

import { ListingHeader } from "@/components/ListingHeader";
import { SearchInput } from "@/components/SearchInput";

export const metadata: Metadata = {
  title: "Search",
  description: "Search all posts.",
  alternates: { canonical: "/search" },
  robots: { index: false, follow: true },
};

/**
 * Render statically - the SearchInput component fetches the Pagefind
 * bundle at runtime and performs all queries client-side, so the
 * page itself doesn't need to re-render per request.
 */
export const dynamic = "force-static";

export default function SearchPage() {
  return (
    <>
      <ListingHeader
        title="Search"
        description="Find posts by keyword. Results update as you type."
      />
      <SearchInput />
    </>
  );
}
