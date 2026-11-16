/**
 * The two helpers `defineCollection` and `defineSingle` share: a label read
 * from a slug, and the authored fields as the system reads them. Each
 * definition is checked through its own default label too, so a definition
 * that went back to a copy of its own would be the one a change here missed.
 */
import { describe, expect, it } from "vitest";

import { defineSingle } from "../../../singles/config/define-single";
import { text } from "../../fields/helpers";
import { pluginField } from "../../fields/types/plugin-field";
import { asDeclaredFields, toTitleCase } from "../declared-config";
import { defineCollection } from "../define-collection";

describe("toTitleCase", () => {
  it("reads a slug's words, split on hyphens and underscores, as a title", () => {
    expect(toTitleCase("blog-posts")).toBe("Blog Posts");
    expect(toTitleCase("header_nav")).toBe("Header Nav");
    expect(toTitleCase("users")).toBe("Users");
  });

  it("names a collection's and a Single's default label", () => {
    const collection = defineCollection({
      slug: "blog-posts",
      fields: [text({ name: "body" })],
    });
    const single = defineSingle({
      slug: "site_settings",
      fields: [text({ name: "tagline" })],
    });
    expect(collection.labels?.singular).toBe("Blog Posts");
    expect(single.label?.singular).toBe("Site Settings");
  });
});

describe("asDeclaredFields", () => {
  it("hands the authored fields on as they are, a contributed one included", () => {
    const authored = [
      text({ name: "title" }),
      pluginField({ name: "score", type: "star-rating" }),
    ];
    const declared = asDeclaredFields(authored);
    expect(declared).toBe(authored);
    expect(declared.map(field => [field.name, field.type])).toEqual([
      ["title", "text"],
      ["score", "star-rating"],
    ]);
  });
});
