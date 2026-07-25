/**
 * Smoke test for the blog template's tag-based ISR wiring.
 *
 * The blog template (repo-root /templates/blog) is downloaded at scaffold time
 * and never built in this workspace, so there is no compile step to catch a
 * regression here. These static assertions guard the F1 conversion: the query
 * layer must cache reads through `nextly/runtime`, and the detail pages must
 * keep build-time `generateStaticParams` while carrying no time-based
 * `revalidate` (freshness comes from tag busting instead).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

// /packages/create-nextly-app/src/__tests__ -> repo root -> /templates/blog
const here = path.dirname(fileURLToPath(import.meta.url));
const BLOG = path.resolve(here, "../../../../templates/blog");

function read(rel: string): string {
  return readFileSync(path.join(BLOG, rel), "utf-8");
}

const DETAIL_PAGES = [
  "src/app/(frontend)/blog/[slug]/page.tsx",
  "src/app/(frontend)/authors/[slug]/page.tsx",
  "src/app/(frontend)/tags/[slug]/page.tsx",
  "src/app/(frontend)/categories/[slug]/page.tsx",
] as const;

describe("blog template — tag-based ISR", () => {
  it.each(DETAIL_PAGES)(
    "%s pre-renders slugs but has no time-based revalidate",
    page => {
      const src = read(page);
      expect(src).toContain("generateStaticParams");
      expect(src).not.toMatch(/export\s+const\s+revalidate\s*=/);
    }
  );

  const COLLECTION_QUERIES = [
    "src/lib/queries/posts.ts",
    "src/lib/queries/categories.ts",
    "src/lib/queries/tags.ts",
    "src/lib/queries/authors.ts",
  ] as const;

  it.each(COLLECTION_QUERIES)(
    "%s caches reads via nextly/runtime cachedFind + nextlyTags",
    file => {
      const src = read(file);
      expect(src).toContain('from "nextly/runtime"');
      expect(src).toContain("cachedFind(");
      expect(src).toContain("nextlyTags(");
    }
  );

  const SINGLE_QUERIES = [
    "src/lib/queries/site-settings.ts",
    "src/lib/queries/navigation.ts",
    "src/lib/queries/homepage.ts",
  ] as const;

  it.each(SINGLE_QUERIES)(
    "%s caches the single via cachedFind + nextlySingleTags",
    file => {
      const src = read(file);
      expect(src).toContain('from "nextly/runtime"');
      expect(src).toContain("cachedFind(");
      expect(src).toContain("nextlySingleTags(");
    }
  );

  it("README documents tag-based revalidation, not a fixed ISR window", () => {
    const readme = read("README.md");
    expect(readme).toContain("tag-based revalidation");
    expect(readme).not.toContain("revalidate every 60 seconds");
  });
});
