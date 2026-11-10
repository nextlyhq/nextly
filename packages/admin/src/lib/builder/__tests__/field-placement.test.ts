/**
 * Where a field sits: the containers above it, outermost first, and the fields
 * beside it. The settings panel builds the API path from the first and offers
 * the second to a condition, so a wrong container order would print a wrong
 * path and a wrong sibling list would offer a field the condition cannot read.
 */
import { describe, expect, it } from "vitest";

import type { BuilderField } from "@admin/components/features/schema-builder/types";

import { collectFieldIds, findFieldPlacement } from "../field-placement";

const url: BuilderField = {
  id: "url",
  name: "url",
  label: "URL",
  type: "text",
};
const network: BuilderField = {
  id: "network",
  name: "network",
  label: "Network",
  type: "select",
};
const social: BuilderField = {
  id: "social",
  name: "social",
  label: "Social",
  type: "repeater",
  fields: [network, url],
};
const authorName: BuilderField = {
  id: "author-name",
  name: "name",
  label: "Name",
  type: "text",
};
const authors: BuilderField = {
  id: "authors",
  name: "authors",
  label: "Authors",
  type: "repeater",
  fields: [authorName, social],
};
const title: BuilderField = {
  id: "title",
  name: "title",
  label: "Title",
  type: "text",
};
const TREE = [title, authors];

describe("findFieldPlacement", () => {
  it("finds a field two levels deep with its containers outermost first", () => {
    const found = findFieldPlacement(TREE, "url");
    expect(found?.field).toBe(url);
    expect(found?.ancestors.map(a => a.id)).toEqual(["authors", "social"]);
    expect(found?.siblings.map(s => s.id)).toEqual(["network"]);
  });

  it("finds a top-level field with no containers and the other top-level fields", () => {
    const found = findFieldPlacement(TREE, "title");
    expect(found?.ancestors).toEqual([]);
    expect(found?.siblings.map(s => s.id)).toEqual(["authors"]);
  });

  it("answers null for an id no field has", () => {
    expect(findFieldPlacement(TREE, "missing")).toBeNull();
  });
});

describe("collectFieldIds", () => {
  it("collects every id, nested ones included", () => {
    expect([...collectFieldIds(TREE)].sort()).toEqual(
      ["author-name", "authors", "network", "social", "title", "url"].sort()
    );
  });
});
