import { describe, expect, it } from "vitest";

import { collectionSchemaName, pascalize, singularize } from "./_inflect";

describe("pascalize", () => {
  it("kebab-case", () => {
    expect(pascalize("email-providers")).toBe("EmailProviders");
  });

  it("snake_case", () => {
    expect(pascalize("user_profile")).toBe("UserProfile");
  });

  it("space separated", () => {
    expect(pascalize("blog posts")).toBe("BlogPosts");
  });

  it("already PascalCase passes through unchanged", () => {
    expect(pascalize("Hero")).toBe("Hero");
  });

  it("collapses repeated separators", () => {
    expect(pascalize("foo--bar__baz")).toBe("FooBarBaz");
  });

  it("empty string", () => {
    expect(pascalize("")).toBe("");
  });
});

describe("singularize", () => {
  it("regular plural: posts -> post", () => {
    expect(singularize("posts")).toBe("post");
  });

  it("ies plural: categories -> category", () => {
    expect(singularize("categories")).toBe("category");
  });

  it("xes plural: boxes -> box", () => {
    expect(singularize("boxes")).toBe("box");
  });

  it("ses plural: classes -> class", () => {
    expect(singularize("classes")).toBe("class");
  });

  it("already singular: media -> media", () => {
    expect(singularize("media")).toBe("media");
  });

  it("doesn't strip 'ss' endings: class -> class", () => {
    // 'class' itself is singular; 'classes' becomes 'class' via the ses rule.
    expect(singularize("class")).toBe("class");
  });

  it("doesn't strip protected '-us' endings: status -> status, bus -> bus", () => {
    expect(singularize("status")).toBe("status");
    expect(singularize("bus")).toBe("bus");
    expect(singularize("virus")).toBe("virus");
  });

  it("irregular plurals (quizzes, mice) pass through unchanged; author overrides via labels.singular", () => {
    // Naive rules don't handle these — collectionSchemaName(slug, label) lets
    // authors fix them explicitly.
    expect(singularize("quizzes")).toBe("quizze"); // imperfect but predictable
    expect(singularize("mice")).toBe("mice");
  });

  it("English exceptions pass through (caller should override): mice -> mice", () => {
    // Naive rules don't handle 'mice' → 'mouse'. Author sets labels.singular.
    expect(singularize("mice")).toBe("mice");
  });
});

describe("collectionSchemaName", () => {
  it("standard plural slug singularizes + pascalizes", () => {
    expect(collectionSchemaName("posts")).toBe("Post");
    expect(collectionSchemaName("categories")).toBe("Category");
    expect(collectionSchemaName("boxes")).toBe("Box");
  });

  it("kebab plural slug", () => {
    expect(collectionSchemaName("email-providers")).toBe("EmailProvider");
  });

  it("idempotent for already-singular slugs", () => {
    expect(collectionSchemaName("media")).toBe("Media");
  });

  it("explicit singularLabel wins outright (skips singularize)", () => {
    expect(collectionSchemaName("people", "Person")).toBe("Person");
    expect(collectionSchemaName("any-slug", "Custom Name")).toBe("CustomName");
  });

  it("ignores singularLabel when it is undefined or empty", () => {
    expect(collectionSchemaName("posts", undefined)).toBe("Post");
    expect(collectionSchemaName("posts", "")).toBe("Post");
  });
});
