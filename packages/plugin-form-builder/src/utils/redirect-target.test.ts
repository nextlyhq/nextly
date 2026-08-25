import { describe, expect, it } from "vitest";

import {
  applyRedirectPattern,
  documentReachability,
  hasPublishLifecycle,
  pickedDocumentField,
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

  it("drops a whitespace-only pattern, which produces a blank URL", () => {
    // `previewUrlFromTemplate` returns whitespace unchanged and it is truthy,
    // so a kept collection would be offered, validated, and then hand a
    // successful submission "   " as its destination.
    expect(
      normalizeRedirectRelationships({ pages: "   ", posts: "/blog/{slug}" })
    ).toEqual({ posts: "/blog/{slug}" });
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

  it("refuses a whitespace-only bare id", () => {
    expect(parseRedirectReference("   ", ["pages"])).toBeNull();
  });

  it("refuses a whitespace-only id inside a reference", () => {
    expect(
      parseRedirectReference({ relationTo: "pages", value: "  " }, ["pages"])
    ).toBeNull();
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

  it("returns the collection name trimmed, not merely accepts it", () => {
    // Accepting a padded name while returning it padded is worse than
    // rejecting it: the validator calls the form valid and every consumer that
    // looks the name up against configuration then fails to find it.
    expect(
      parseRedirectReference({ relationTo: " pages ", value: "p1" }, many)
    ).toEqual({ collection: "pages", id: "p1" });
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

describe("hasPublishLifecycle", () => {
  it("recognises a document the lifecycle manages", () => {
    // `firstPublishedAt` is written by the framework and is present even on a
    // never-published draft, so it marks the lifecycle rather than the act of
    // publishing.
    expect(hasPublishLifecycle({ id: "1", firstPublishedAt: null })).toBe(true);
  });

  it("does not mistake an ordinary field named status for a lifecycle", () => {
    // A collection without the lifecycle may legally define its own `status`
    // field. Reading the NAME as a lifecycle marks live documents as drafts.
    expect(hasPublishLifecycle({ id: "1", status: "active" })).toBe(false);
  });
});

describe("documentReachability", () => {
  const managed = (over = {}) => ({ id: "1", firstPublishedAt: null, ...over });

  it("treats a collection with no publish lifecycle as reachable", () => {
    // No `status` FIELD at all. Reading this as unpublished would refuse every
    // redirect on every site that never turned drafts on.
    expect(documentReachability({ id: "1", slug: "thanks" }, false)).toBe(
      "reachable"
    );
  });

  it("treats a document with its own status field as reachable", () => {
    // `status: "active"` on an unmanaged collection is not a draft.
    expect(documentReachability({ id: "1", status: "active" }, false)).toBe(
      "reachable"
    );
  });

  it("reads a published document as reachable", () => {
    expect(documentReachability(managed({ status: "published" }), false)).toBe(
      "reachable"
    );
  });

  it("reads a never-published document as unreachable, localized or not", () => {
    // The one judgement that holds whatever the collection's `localized`
    // setting is: nothing has ever been public in any language.
    for (const localized of [true, false, undefined]) {
      expect(
        documentReachability(managed({ status: "draft" }), localized)
      ).toBe("unreachable");
    }
  });

  it("reads a previously-published draft as unreachable only when the collection is not localized", () => {
    const unpublished = managed({
      status: "draft",
      firstPublishedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(documentReachability(unpublished, false)).toBe("unreachable");
  });

  it("cannot decide for a previously-published draft on a localized collection", () => {
    // A localized collection publishes per locale, on a companion row no read
    // available here returns. Measured: a document whose Spanish translation
    // is public answers `status: "draft"` at every locale, and a
    // published-only `find` returns it at none. Calling that unreachable marks
    // a page visitors can reach as a draft and refuses a correct save.
    const unpublished = managed({
      status: "draft",
      firstPublishedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(documentReachability(unpublished, true)).toBe("unknown");
  });

  it("cannot decide when the caller does not know the localization setting", () => {
    // A collection hook cannot read it: `req` carries headers, query and the
    // Direct API and nothing else. Undefined must not collapse to false.
    const unpublished = managed({
      status: "draft",
      firstPublishedAt: "2026-08-25T00:00:00.000Z",
    });
    expect(documentReachability(unpublished, undefined)).toBe("unknown");
  });

  it("reads any other managed state the same way it reads draft", () => {
    for (const status of ["archived", "scheduled", "", "review"]) {
      expect(documentReachability(managed({ status }), false)).toBe(
        "unreachable"
      );
    }
  });

  it("reads a managed document with a non-string status as unreachable", () => {
    expect(documentReachability(managed({ status: null }), false)).toBe(
      "unreachable"
    );
  });
});

describe("pickedDocumentField", () => {
  it("names the field the page picker writes", () => {
    expect(pickedDocumentField({ confirmationType: "relationship" })).toBe(
      "redirectPage"
    );
  });

  it("names the relation the URL option falls back to", () => {
    // The shape code-first and legacy forms use. The submission path has
    // always resolved it; before this it was the one picked document the save
    // rule never inspected.
    expect(
      pickedDocumentField({
        confirmationType: "redirect",
        redirectRelation: { relationTo: "pages", value: "p1" },
      })
    ).toBe("redirectRelation");
  });

  it("prefers a typed URL over a relation left beside it", () => {
    // A stored relation from an earlier edit does not make the form redirect
    // to a document; the URL does, and the resolver returns it verbatim.
    expect(
      pickedDocumentField({
        confirmationType: "redirect",
        redirectUrl: "https://example.test/thanks",
        redirectRelation: { relationTo: "pages", value: "p1" },
      })
    ).toBeNull();
  });

  it("names nothing when the URL option carries no relation", () => {
    // Not an error here: an absent relation means no destination is
    // configured yet, which `validateFormConfig` governs. Reporting it would
    // refuse saves this rule never governed.
    expect(pickedDocumentField({ confirmationType: "redirect" })).toBeNull();
  });

  it("names nothing for a form that shows a message", () => {
    expect(pickedDocumentField({ confirmationType: "message" })).toBeNull();
    expect(pickedDocumentField({})).toBeNull();
  });

  it("still names the page field when the picker stored nothing", () => {
    // "Redirect to a page" naming no page contradicts the option itself, so
    // the field is returned and the caller reports it — unlike the URL option,
    // where an absent relation is merely unfinished.
    expect(pickedDocumentField({ confirmationType: "relationship" })).toBe(
      "redirectPage"
    );
  });
});
