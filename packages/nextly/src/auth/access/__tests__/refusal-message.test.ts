/**
 * A refusal's message names the action and the thing in the site's own words.
 *
 * The thing is a collection's label, a Single's label or a system resource's
 * name, never a slug or a permission as stored. A slug the site does not know
 * is never repeated back, so a caller cannot make a refusal echo a URL.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { container } from "../../../di/container";
import { refusalMessage } from "../refusal-message";

const CONFIG = {
  collections: [
    { slug: "posts", labels: { singular: "Post", plural: "Posts" } },
    {
      slug: "blog-posts",
      labels: { singular: "Blog Post", plural: "Blog Posts" },
    },
    { slug: "faqs", labels: { singular: "FAQ", plural: "FAQs" } },
    // Registered without labels: named from its own slug.
    { slug: "case-studies" },
  ],
  singles: [{ slug: "site-settings", label: { singular: "Site Settings" } }],
};

describe("a refusal's message", () => {
  // The site's registered configuration, as a booted instance holds it,
  // taken away again after.
  beforeAll(() => {
    container.register("config", () => CONFIG);
  });
  afterAll(() => {
    container.clear();
  });

  it("names the action and one entry of a collection", () => {
    expect(refusalMessage("update", "posts", "one")).toBe(
      "You can't edit this post."
    );
    expect(refusalMessage("read", "blog-posts", "one")).toBe(
      "You can't see this blog post."
    );
  });

  it("names the action and the collection when no one entry is named", () => {
    expect(refusalMessage("create", "posts")).toBe("You can't create posts.");
    expect(refusalMessage("read", "posts")).toBe("You can't see posts.");
    expect(refusalMessage("delete", "blog-posts")).toBe(
      "You can't delete blog posts."
    );
  });

  it("keeps an acronym in a label as written", () => {
    expect(refusalMessage("read", "faqs")).toBe("You can't see FAQs.");
  });

  it("names a collection registered without labels from its slug", () => {
    expect(refusalMessage("read", "case-studies")).toBe(
      "You can't see case studies."
    );
  });

  it("names a Single by its label", () => {
    expect(refusalMessage("update", "site-settings")).toBe(
      "You can't edit Site Settings."
    );
  });

  it("names a system resource in words", () => {
    expect(refusalMessage("read", "users")).toBe("You can't see users.");
    expect(refusalMessage("update", "email-providers")).toBe(
      "You can't edit email providers."
    );
    expect(refusalMessage("create", "api-keys")).toBe(
      "You can't create API keys."
    );
    expect(refusalMessage("manage", "settings")).toBe(
      "You can't manage settings."
    );
  });

  it("never repeats a slug the site does not know, or none at all", () => {
    expect(refusalMessage("read", "anything-a-url-says")).toBe(
      "You can't do that."
    );
    expect(refusalMessage("manage", "")).toBe("You can't do that.");
  });
});
