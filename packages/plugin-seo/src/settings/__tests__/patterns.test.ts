import { describe, expect, it } from "vitest";

import { patternFields, tokenOf } from "../pattern-fields";
import {
  DEFAULT_TITLE_PATTERN,
  defaultTitlePattern,
  unknownTokens,
} from "../patterns";

const postFields = [
  { name: "title", type: "text", label: "Title" },
  { name: "excerpt", type: "textarea" },
  { name: "category", type: "text", label: "Category" },
  { name: "publishedAt", type: "date", label: "Published" },
  { name: "readingTime", type: "number", label: "Reading time" },
  { name: "cover", type: "upload" },
  { name: "seo", type: "group", fields: [{ name: "metaTitle", type: "text" }] },
  { name: "author", type: "relationship", label: "Author" },
];

describe("the variables a content type offers", () => {
  it("offers the text and number fields the page's title can be made from", () => {
    expect(patternFields(postFields).map(field => field.name)).toEqual([
      "excerpt",
      "category",
      "readingTime",
    ]);
  });

  it("never offers the title itself or the SEO group again", () => {
    const names = patternFields(postFields).map(field => field.name);
    expect(names).not.toContain("title");
    expect(names).not.toContain("seo");
  });

  it("never offers a field {Title} already reads on a type with no title", () => {
    expect(
      patternFields([
        { name: "name", type: "text" },
        { name: "heading", type: "text" },
        { name: "role", type: "text" },
      ]).map(field => field.name)
    ).toEqual(["role"]);
  });

  it("words a variable by the field's label where it names the field", () => {
    expect(tokenOf({ name: "readingTime", label: "Reading time" })).toBe(
      "Reading time"
    );
    expect(tokenOf({ name: "category", label: "Category" })).toBe("Category");
  });

  it("words it by the field's name where the label says something else", () => {
    // The variable is matched to the page's field by its name, so a label
    // that names something else would make a variable that never fills.
    expect(tokenOf({ name: "publishedAt", label: "Date" })).toBe(
      "Published At"
    );
    expect(tokenOf({ name: "excerpt" })).toBe("Excerpt");
  });
});

describe("a pattern's variables", () => {
  const fields = patternFields(postFields);

  it("accepts the title, the site name and the type's own fields", () => {
    expect(unknownTokens("{Title} · {Category} | {Site name}", fields)).toEqual(
      []
    );
    expect(unknownTokens("{title} – {site name}", fields)).toEqual([]);
    expect(unknownTokens("{Reading time} min: {Title}", fields)).toEqual([]);
  });

  it("names each variable the type has no field for, once", () => {
    expect(
      unknownTokens("{Title} by {Author} {Author} | {Brand}", fields)
    ).toEqual(["Author", "Brand"]);
  });

  it("finds nothing to refuse in plain text", () => {
    expect(unknownTokens("Our blog", fields)).toEqual([]);
  });
});

describe("the default pattern", () => {
  it("is the title, the separator and the site name", () => {
    expect(DEFAULT_TITLE_PATTERN).toBe("{Title} | {Site name}");
    expect(defaultTitlePattern("—")).toBe("{Title} — {Site name}");
  });
});
