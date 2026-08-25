import { describe, expect, it } from "vitest";

import {
  applyRedirectPattern,
  DEFAULT_REDIRECT_PATTERN,
  normalizeRedirectRelationships,
  parseRedirectReference,
} from "./redirect-target";

describe("normalizeRedirectRelationships", () => {
  it("gives the array shorthand the default pattern", () => {
    expect(normalizeRedirectRelationships(["pages", "posts"])).toEqual({
      pages: DEFAULT_REDIRECT_PATTERN,
      posts: DEFAULT_REDIRECT_PATTERN,
    });
  });

  it("keeps a per-collection pattern", () => {
    expect(
      normalizeRedirectRelationships({
        pages: "/{slug}",
        posts: "/blog/{slug}",
      })
    ).toEqual({ pages: "/{slug}", posts: "/blog/{slug}" });
  });

  it("drops a collection whose pattern cannot produce a URL", () => {
    // Kept, it would be offered in the picker and accepted by validation while
    // resolving to nothing at submit time.
    expect(
      normalizeRedirectRelationships({ pages: "", posts: "/blog/{slug}" })
    ).toEqual({ posts: "/blog/{slug}" });
  });

  it("keeps a function pattern, which has no empty form", () => {
    const pattern = () => "/x";
    expect(normalizeRedirectRelationships({ pages: pattern })).toEqual({
      pages: pattern,
    });
  });

  it("treats an unset option as no redirect collections", () => {
    expect(normalizeRedirectRelationships(undefined)).toEqual({});
    expect(normalizeRedirectRelationships([])).toEqual({});
  });

  it("copies rather than aliasing the caller's object", () => {
    // The resolved config outlives the options object, and a plugin that
    // mutates its own options afterwards must not change what was resolved.
    const option = { pages: "/{slug}" };
    const resolved = normalizeRedirectRelationships(option);
    option.pages = "/changed";
    expect(resolved.pages).toBe("/{slug}");
  });
});

describe("parseRedirectReference", () => {
  const many = ["pages", "posts"];

  it("reads the polymorphic shape", () => {
    expect(
      parseRedirectReference({ relationTo: "posts", value: "p1" }, many)
    ).toEqual({ collection: "posts", id: "p1" });
  });

  it("reads the polymorphic shape when the row is populated", () => {
    // A read at depth replaces the id with the row it points at.
    expect(
      parseRedirectReference(
        { relationTo: "pages", value: { id: "pg1", slug: "about" } },
        many
      )
    ).toEqual({ collection: "pages", id: "pg1" });
  });

  it("reads a bare id when exactly one collection is configured", () => {
    expect(parseRedirectReference("pg1", ["pages"])).toEqual({
      collection: "pages",
      id: "pg1",
    });
  });

  it("refuses an empty bare id", () => {
    // A cleared field is not a reference to the empty document. Accepting it
    // lets validation pass a form whose every submission ends nowhere.
    expect(parseRedirectReference("", ["pages"])).toBeNull();
  });

  it("refuses a bare id when several collections are configured", () => {
    // The id names no collection, and picking one would build the URL from
    // another collection's pattern — a wrong destination, not a missing one.
    expect(parseRedirectReference("pg1", many)).toBeNull();
  });

  it("refuses a populated row that names no collection, when several exist", () => {
    expect(
      parseRedirectReference({ id: "pg1", slug: "about" }, many)
    ).toBeNull();
  });

  it("reads a populated row with no relationTo when only one collection exists", () => {
    expect(
      parseRedirectReference({ id: "pg1", slug: "about" }, ["pages"])
    ).toEqual({ collection: "pages", id: "pg1" });
  });

  it("refuses a blank collection name", () => {
    // Truthy, and not a collection. The public validator would call the form
    // valid while the collection save refuses it and submit-time resolution
    // produces no URL.
    expect(
      parseRedirectReference({ relationTo: "", value: "p1" }, many)
    ).toBeNull();
    expect(
      parseRedirectReference({ relationTo: "   ", value: "p1" }, many)
    ).toBeNull();
  });

  it("has nothing to read from an unset or empty value", () => {
    for (const empty of [null, undefined, "", [], { relationTo: "pages" }]) {
      expect(parseRedirectReference(empty, many)).toBeNull();
    }
  });
});

describe("applyRedirectPattern", () => {
  const page = { id: "pg1", slug: "thank-you" };

  it("fills a placeholder from the document", () => {
    expect(applyRedirectPattern("/{slug}", page)).toBe("/thank-you");
    expect(applyRedirectPattern("/blog/{slug}", page)).toBe("/blog/thank-you");
  });

  it("fills several placeholders, including repeats", () => {
    expect(applyRedirectPattern("/{slug}/{id}/{slug}", page)).toBe(
      "/thank-you/pg1/thank-you"
    );
  });

  it("returns nothing when a placeholder has no value", () => {
    // `/undefined` and `/` are both real URLs that go somewhere wrong, so a
    // form that cannot build its destination must report having none.
    expect(applyRedirectPattern("/{slug}", { id: "pg1" })).toBeUndefined();
    expect(
      applyRedirectPattern("/{slug}", { id: "pg1", slug: "" })
    ).toBeUndefined();
  });

  it("accepts a numeric field", () => {
    expect(applyRedirectPattern("/p/{year}", { id: "x", year: 2026 })).toBe(
      "/p/2026"
    );
  });

  it("encodes what it substitutes", () => {
    // A slug is author-entered text, not a URL segment. Left raw, a space or
    // a `#` produces a link that goes somewhere other than the page picked.
    expect(
      applyRedirectPattern("/{slug}", { id: "1", slug: "thank you" })
    ).toBe("/thank%20you");
    expect(applyRedirectPattern("/{slug}", { id: "1", slug: "a#b" })).toBe(
      "/a%23b"
    );
  });

  it("substitutes a falsey value that is still a real segment", () => {
    // `0` and `false` are values; only null, undefined and empty string mean
    // the field has nothing to give.
    expect(applyRedirectPattern("/p/{page}", { id: "1", page: 0 })).toBe(
      "/p/0"
    );
    expect(applyRedirectPattern("/p/{flag}", { id: "1", flag: false })).toBe(
      "/p/false"
    );
  });

  it("passes a pattern with no placeholders through", () => {
    expect(applyRedirectPattern("/thanks", page)).toBe("/thanks");
  });

  it("calls the function form with the document", () => {
    expect(applyRedirectPattern(doc => `/x/${String(doc.slug)}`, page)).toBe(
      "/x/thank-you"
    );
  });

  it("returns nothing when the function declines", () => {
    expect(applyRedirectPattern(() => undefined, page)).toBeUndefined();
    expect(applyRedirectPattern(() => "", page)).toBeUndefined();
  });
});
