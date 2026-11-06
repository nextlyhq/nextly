/**
 * The one rule for which Layout a page is drawn inside, over every
 * combination a writer can store: the switch on or off, the page naming
 * nothing, a published Layout, an unpublished one or one that is gone, and
 * the site default set and published, set and not published, or not set.
 */
import { describe, expect, it } from "vitest";

import { resolvePageLayout, type LayoutSite } from "./resolve-layout";

/** A site whose published Layouts are `published`, and whose default is `defaultLayout`. */
function site(
  defaultLayout: string | null,
  published: readonly string[]
): LayoutSite {
  return { defaultLayout, isPublished: id => published.includes(id) };
}

const PAGE_CHOICES = [
  { name: "names nothing", layout: null },
  { name: "names a published Layout", layout: "blog" },
  { name: "names an unpublished Layout", layout: "draft-only" },
  { name: "names a Layout that is gone", layout: "deleted" },
] as const;

const DEFAULTS = [
  { name: "a published default", defaultLayout: "main" },
  { name: "an unpublished default", defaultLayout: "draft-only" },
  { name: "no default", defaultLayout: null },
] as const;

const PUBLISHED = ["main", "blog"];

describe("resolvePageLayout", () => {
  describe("with the header and footer switched off", () => {
    for (const choice of PAGE_CHOICES) {
      for (const fallback of DEFAULTS) {
        it(`draws no regions when the page ${choice.name}, with ${fallback.name}`, () => {
          expect(
            resolvePageLayout(
              { layout: choice.layout, noHeaderFooter: true },
              site(fallback.defaultLayout, PUBLISHED)
            )
          ).toEqual({ kind: "none", reason: "switched-off" });
        });
      }
    }
  });

  describe("with the switch off or unset", () => {
    for (const noHeaderFooter of [false, null, undefined]) {
      it(`uses the page's own published Layout (switch ${String(noHeaderFooter)})`, () => {
        expect(
          resolvePageLayout(
            { layout: "blog", noHeaderFooter },
            site("main", PUBLISHED)
          )
        ).toEqual({ kind: "layout", id: "blog", source: "page" });
      });
    }

    it("uses the default for a page that names nothing", () => {
      expect(
        resolvePageLayout({ layout: null }, site("main", PUBLISHED))
      ).toEqual({ kind: "layout", id: "main", source: "default" });
      expect(resolvePageLayout({}, site("main", PUBLISHED))).toEqual({
        kind: "layout",
        id: "main",
        source: "default",
      });
    });

    for (const gone of ["draft-only", "deleted"]) {
      it(`falls back to the default, and says from what, for a page naming "${gone}"`, () => {
        expect(
          resolvePageLayout({ layout: gone }, site("main", PUBLISHED))
        ).toEqual({
          kind: "layout",
          id: "main",
          source: "default",
          fellBackFrom: gone,
        });
      });
    }

    it("draws no regions, and says so, when the default is not published", () => {
      expect(
        resolvePageLayout({ layout: null }, site("draft-only", PUBLISHED))
      ).toEqual({ kind: "none", reason: "no-default" });
      expect(
        resolvePageLayout({ layout: "deleted" }, site("draft-only", PUBLISHED))
      ).toEqual({
        kind: "none",
        reason: "no-default",
        fellBackFrom: "deleted",
      });
    });

    it("draws no regions when no default is set", () => {
      expect(resolvePageLayout({}, site(null, PUBLISHED))).toEqual({
        kind: "none",
        reason: "no-default",
      });
    });

    it("still uses the page's own published Layout when the default is not usable", () => {
      // The page's choice does not depend on the default.
      expect(
        resolvePageLayout({ layout: "blog" }, site(null, PUBLISHED))
      ).toEqual({ kind: "layout", id: "blog", source: "page" });
    });
  });
});
