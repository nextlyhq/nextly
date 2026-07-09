import { describe, it, expect } from "vitest";

import { text } from "../../fields/helpers";
import { defineCollection } from "../define-collection";

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
