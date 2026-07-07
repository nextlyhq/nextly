import { describe, it, expect } from "vitest";

import { normalizeCollections, normalizeFields } from "./collectionsApi";

describe("normalizeCollections", () => {
  it("maps name→slug + label and drops hidden/blank", () => {
    const body = {
      items: [
        { name: "posts", label: "Posts" },
        { name: "authors", label: "Authors", admin: { hidden: true } },
        { name: "", label: "Nameless" },
        { name: "pages", labels: { plural: "Pages" } },
      ],
    };
    expect(normalizeCollections(body)).toEqual([
      { slug: "posts", label: "Posts" },
      { slug: "pages", label: "Pages" },
    ]);
  });

  it("returns [] for a malformed body", () => {
    expect(normalizeCollections({})).toEqual([]);
    expect(normalizeCollections(null)).toEqual([]);
  });
});

describe("normalizeFields", () => {
  it("coerces name/type/label and drops nameless fields", () => {
    const body = {
      fields: [
        { name: "title", type: "text", label: "Title" },
        { name: "body", type: "richText" },
        { type: "text", label: "no name" },
      ],
    };
    expect(normalizeFields(body)).toEqual([
      { name: "title", type: "text", label: "Title" },
      { name: "body", type: "richText", label: "body" },
    ]);
  });

  it("returns [] for a malformed body", () => {
    expect(normalizeFields({})).toEqual([]);
  });
});
