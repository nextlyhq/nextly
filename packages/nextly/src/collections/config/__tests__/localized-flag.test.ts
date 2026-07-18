import { describe, it, expect } from "vitest";

import { text } from "../../fields/helpers";
import { defineCollection } from "../define-collection";
import { defineConfig } from "../define-config";

describe("collection-level localized flag", () => {
  it("is preserved on the sanitized collection", () => {
    const c = defineCollection({
      slug: "pages",
      localized: true,
      fields: [text({ name: "title" })],
    });
    expect(c.localized).toBe(true);
  });

  it("defaults to undefined when not set", () => {
    const c = defineCollection({
      slug: "posts",
      fields: [text({ name: "title" })],
    });
    expect(c.localized).toBeUndefined();
  });
});

describe("localized content requires app localization config", () => {
  it("rejects a collection-level localized flag when the app has no localization config", () => {
    expect(() =>
      defineConfig({
        collections: [
          defineCollection({
            slug: "pages",
            localized: true,
            fields: [text({ name: "title" })],
          }),
        ],
      })
    ).toThrow(/localization/i);
  });

  it("rejects a field-level localized flag when the app has no localization config", () => {
    expect(() =>
      defineConfig({
        collections: [
          defineCollection({
            slug: "pages",
            fields: [text({ name: "title", localized: true })],
          }),
        ],
      })
    ).toThrow(/localization/i);
  });

  it("accepts localized content when the app declares localization", () => {
    expect(() =>
      defineConfig({
        localization: { locales: ["en", "de"], defaultLocale: "en" },
        collections: [
          defineCollection({
            slug: "pages",
            localized: true,
            fields: [text({ name: "title" })],
          }),
        ],
      })
    ).not.toThrow();
  });
});
