import { describe, expect, it } from "vitest";

import {
  isContentTypeScope,
  typesReachedBy,
  type ContentTypeCandidate,
} from "./content-type-scope";

const site = (
  slug: string,
  kind: ContentTypeCandidate["kind"] = "collection"
): ContentTypeCandidate => ({ slug, kind });

const types: ContentTypeCandidate[] = [
  site("posts"),
  site("pages"),
  site("homepage", "single"),
  site("hero", "fieldGroup"),
  { slug: "form-submissions", kind: "collection", plugin: "@acme/forms" },
  { slug: "forms-settings", kind: "single", plugin: "@acme/forms" },
  site("users"),
  site("media"),
];

const slugsOf = (reached: ContentTypeCandidate[]): string[] =>
  reached.map(type => type.slug);

describe("typesReachedBy", () => {
  it("reaches every collection and Single the site defines", () => {
    expect(
      slugsOf(typesReachedBy({ every: ["collection", "single"] }, types))
    ).toEqual(["posts", "pages", "homepage"]);
  });

  it("reaches only the kinds it names", () => {
    expect(slugsOf(typesReachedBy({ every: ["single"] }, types))).toEqual([
      "homepage",
    ]);
    expect(slugsOf(typesReachedBy({ every: ["collection"] }, types))).toEqual(
      ["posts", "pages"]
    );
  });

  it("never reaches a plugin's own types", () => {
    const reached = slugsOf(
      typesReachedBy({ every: ["collection", "single"] }, types)
    );
    expect(reached).not.toContain("form-submissions");
    expect(reached).not.toContain("forms-settings");
  });

  it("never reaches Nextly's system types, even when the site configures one", () => {
    const reached = slugsOf(
      typesReachedBy({ every: ["collection", "single"] }, types)
    );
    expect(reached).not.toContain("users");
    expect(reached).not.toContain("media");
  });

  it("never reaches a field group, which is not a content type", () => {
    expect(
      slugsOf(typesReachedBy({ every: ["collection", "single"] }, types))
    ).not.toContain("hero");
  });

  it("leaves out each type it excepts, by slug", () => {
    expect(
      slugsOf(
        typesReachedBy(
          { every: ["collection", "single"], except: ["pages", "homepage"] },
          types
        )
      )
    ).toEqual(["posts"]);
  });

  it("reaches a type made later the same way, so a list of slugs is never needed", () => {
    const later = [...types, site("case-studies")];
    expect(
      slugsOf(typesReachedBy({ every: ["collection"] }, later))
    ).toContain("case-studies");
  });

  it("ignores an excepted slug no type has", () => {
    expect(
      slugsOf(typesReachedBy({ every: ["single"], except: ["gone"] }, types))
    ).toEqual(["homepage"]);
  });
});

describe("isContentTypeScope", () => {
  it("accepts a scope naming one or both kinds, with or without exceptions", () => {
    expect(isContentTypeScope({ every: ["collection"] })).toBe(true);
    expect(
      isContentTypeScope({ every: ["collection", "single"], except: ["a"] })
    ).toBe(true);
  });

  it("refuses a slug, a list of slugs and malformed scopes", () => {
    expect(isContentTypeScope("posts")).toBe(false);
    expect(isContentTypeScope(["posts"])).toBe(false);
    expect(isContentTypeScope({ every: [] })).toBe(false);
    expect(isContentTypeScope({ every: ["fieldGroup"] })).toBe(false);
    expect(isContentTypeScope({ every: ["collection"], except: "a" })).toBe(
      false
    );
    expect(isContentTypeScope({ every: ["collection"], except: [1] })).toBe(
      false
    );
    expect(isContentTypeScope(null)).toBe(false);
  });
});
