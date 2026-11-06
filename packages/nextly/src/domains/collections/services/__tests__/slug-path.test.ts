/**
 * A slug that may hold several segments (`db.slugPaths`), as stored.
 *
 * What separates a correct rule from a plausible broken one:
 * - a one-segment value comes out exactly as `generateSlug` makes it, so
 *   turning the option on changes no existing address;
 * - each segment of a path is normalised as a one-segment slug is;
 * - an empty, dot or emptied segment, a reserved path and an over-long path
 *   are REFUSED, never rewritten into an address nobody asked for. The dot
 *   check runs before normalising, since `generateSlug("..")` is "".
 */
import { describe, expect, it } from "vitest";

import { generateSlug, normalizeSlugPath } from "../collection-utils";

const problem = (value: string): string => {
  const read = normalizeSlugPath(value);
  return "problem" in read ? read.problem : `stored as ${read.slug}`;
};

describe("a slug path", () => {
  it.each(["About Us", "hello--world", "  x  ", "你好", "", "Café"])(
    "treats the one-segment value %j exactly as generateSlug does",
    value => {
      expect(normalizeSlugPath(value)).toEqual({ slug: generateSlug(value) });
    }
  );

  it("normalises each segment of a path as a one-segment slug", () => {
    expect(normalizeSlugPath("Docs/Getting Started/Install")).toEqual({
      slug: "docs/getting-started/install",
    });
    expect(normalizeSlugPath("/blog/about/")).toEqual({ slug: "blog/about" });
  });

  it("refuses an empty segment rather than collapsing it", () => {
    expect(problem("docs//install")).toContain("an empty part");
    expect(problem("//docs")).toContain("an empty part");
  });

  it.each(["docs/../admin", "./docs", "docs/."])(
    "refuses the dot segment in %j",
    value => {
      expect(problem(value)).toContain("which a browser removes");
    }
  );

  it("refuses a segment with nothing left once normalised", () => {
    expect(problem("docs/你好")).toContain('"你好" has no letters or numbers');
  });

  it.each(["admin/pages", "Admin/x", "api/v1", "_next/static", "admin", "API"])(
    "refuses the reserved path %j",
    value => {
      expect(problem(value)).toContain("is reserved for the site itself");
    }
  );

  it("refuses a path longer than a column holds, and keeps one that fits", () => {
    const part = "a".repeat(50);
    const fits = Array.from({ length: 5 }, () => part).join("/");
    expect(fits).toHaveLength(254);
    expect(normalizeSlugPath(fits)).toEqual({ slug: fits });
    expect(problem(`${fits}/bb`)).toContain("Keep it to 255");
    // One segment is held to the same column.
    expect(problem("a".repeat(256))).toContain("Keep it to 255");
  });
});
