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
import { copyPlainValues } from "../../../shared/lib/plain-copy";
import {
  asDeclaredFields,
  ownIdentityFieldNames,
  toTitleCase,
} from "../declared-config";
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

describe("ownIdentityFieldNames", () => {
  it("names a title or slug the Single's author declared, and not the ones defineSingle added", () => {
    const own = defineSingle({
      slug: "blog_page",
      fields: [text({ name: "title" }), text({ name: "intro" })],
    });
    const system = defineSingle({
      slug: "contact_page",
      fields: [text({ name: "intro" })],
    });

    expect(ownIdentityFieldNames(own.fields)).toEqual(["title"]);
    expect(ownIdentityFieldNames(system.fields)).toEqual([]);
  });

  it("keeps telling the added fields apart through the copies the boot and a setup make", () => {
    // The boot hands plugins copies of the configuration and goes on with what their setups
    // return, so the live definition holds copies of the fields defineSingle made. A mark the
    // copy dropped would read Nextly's own title as the author's.
    const system = defineSingle({
      slug: "contact_page",
      fields: [text({ name: "intro" })],
    });
    const copied = copyPlainValues(system.fields, { freeze: true });
    const spread = system.fields.map(field => ({ ...field }));

    expect(copied[0]).not.toBe(system.fields[0]);
    expect(ownIdentityFieldNames(copied)).toEqual([]);
    expect(ownIdentityFieldNames(spread)).toEqual([]);
  });

  it("reads a field inside a group with no name as one of the row's", () => {
    const fields = [
      { type: "row", fields: [text({ name: "slug" })] },
      text({ name: "intro" }),
    ];

    expect(ownIdentityFieldNames(fields)).toEqual(["slug"]);
  });

  it("names none for a Single with no live definition, as a Schema Builder one has", () => {
    expect(ownIdentityFieldNames(undefined)).toEqual([]);
  });
});
