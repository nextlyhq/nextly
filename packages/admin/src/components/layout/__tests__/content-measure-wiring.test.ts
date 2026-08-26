/**
 * Guards that the content routes read the shared measure rather than a literal.
 *
 * A content page renders in several states — a loading skeleton, a handful of
 * error cards, and the loaded document — and only the last reaches
 * `MeasuredPageFrame`. The others build their own container, so rendering the
 * frame and comparing it against a reference built from the same constant
 * cannot see them: both sides derive from one source, so the comparison proves
 * the frame reads the constant and nothing about the skeleton beside it.
 *
 * The property that actually matters is that no state names a width of its own.
 * A skeleton at one measure followed by a document at another moves every field
 * sideways at the moment data arrives, and because each literal is correct on
 * its own terms, the disagreement is visible only by comparing the sites.
 *
 * Reading the route source is what reaches those states. Rendering them would be
 * stronger and is not available: the skeletons are module-private, and exporting
 * three components so a test can see them widens the package's surface to serve
 * the test rather than a caller.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** Repo-relative, resolved from the package root vitest runs in. */
const SRC = join(process.cwd(), "src");

/** Every route whose page is a document rather than a settings form. */
const CONTENT_ROUTES = [
  "pages/dashboard/entries/[slug]/[id]/index.tsx",
  "pages/dashboard/entries/[slug]/create.tsx",
  "pages/dashboard/singles/[slug]/index.tsx",
] as const;

/**
 * A settings route, which SHOULD carry a literal `width="form"`.
 *
 * The must-differ control. A scan that reported "no literal widths" everywhere
 * — because its pattern never matched anything — would satisfy every assertion
 * about the content routes while checking nothing at all.
 */
const SETTINGS_ROUTE = "pages/dashboard/settings/webhooks/create.tsx";

const WIDTH_PROP = /<PageContainer\s[^>]*width=(\{[^}]*\}|"[^"]*")/g;

function widthsIn(relative: string): string[] {
  const source = readFileSync(join(SRC, relative), "utf8");
  return [...source.matchAll(WIDTH_PROP)].map(m => m[1] as string);
}

describe("content routes read the shared measure", () => {
  for (const route of CONTENT_ROUTES) {
    it(`${route} names no width of its own`, () => {
      const widths = widthsIn(route);
      // The population assertion. Without it, a renamed file or a pattern that
      // stopped matching yields an empty list, and "no literals" passes over a
      // route the test never read.
      expect(widths.length).toBeGreaterThan(0);
      for (const w of widths) {
        expect(w).toBe("{CONTENT_PAGE_MEASURE}");
      }
    });
  }

  it("discriminates: a settings route still declares its own literal", () => {
    // If this ever comes back as the constant, either settings pages were swept
    // up by mistake or the scan has stopped seeing literals — and in the second
    // case every assertion above is passing on nothing.
    const widths = widthsIn(SETTINGS_ROUTE);
    expect(widths.length).toBeGreaterThan(0);
    expect(widths).toContain('"form"');
  });
});
