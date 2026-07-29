/**
 * The diff renderer must paint each node kind legibly: text as insert/delete
 * runs, scalars as before and after, relationships as added/removed chips,
 * lists item-by-item with their badges, and a dropped field as clearly gone.
 * It also resolves each value against the real schema field, so cardinality and
 * options survive, and never dresses an unchanged value up as an edit.
 */
import type { FieldConfig } from "nextly/config";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";
import type { FieldDiff } from "@admin/services/versionApi";

import { FieldDiffNode } from "../FieldDiffNode";

describe("FieldDiffNode", () => {
  it("renders a text field as insert and delete runs", () => {
    const node: FieldDiff = {
      kind: "text",
      name: "title",
      label: "Title",
      type: "text",
      status: "changed",
      segments: [
        { op: 0, text: "Hello " },
        { op: -1, text: "world" },
        { op: 1, text: "there" },
      ],
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("world").tagName).toBe("DEL");
    expect(screen.getByText("there").tagName).toBe("INS");
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("shows before and after for a changed scalar", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "views",
      label: "Views",
      type: "number",
      status: "changed",
      before: 1,
      after: 2,
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("shows an unchanged scalar once, not as a struck removal", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "slug",
      label: "Slug",
      type: "text",
      status: "unchanged",
      before: "unchanged-slug",
      after: "unchanged-slug",
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    // Rendered once (a struck before plus an after would be two occurrences).
    expect(screen.getAllByText("unchanged-slug")).toHaveLength(1);
    expect(screen.getByText("Unchanged")).toBeInTheDocument();
  });

  it("resolves the real field so a hasMany value keeps its items", () => {
    const fields = [
      { name: "scores", type: "number", hasMany: true, label: "Scores" },
    ] as FieldConfig[];
    const node: FieldDiff = {
      kind: "value",
      name: "scores",
      label: "Scores",
      type: "number",
      status: "changed",
      before: [1, 2],
      after: [1, 2, 3],
    };
    render(<FieldDiffNode node={node} fields={fields} />);

    // With the real hasMany config the array renders its members; without it
    // the value would normalize to null and read "Not set".
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/Not set/)).not.toBeInTheDocument();
  });

  it("shows only the new value for an added field", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "note",
      label: "Note",
      type: "text",
      status: "added",
      before: null,
      after: "brand new",
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("brand new")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("renders a relationship set as added and removed target chips", () => {
    const node: FieldDiff = {
      kind: "set",
      name: "tags",
      label: "Tags",
      type: "relationship",
      status: "changed",
      added: [{ id: "c" }],
      removed: [{ id: "a" }],
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("renders list items with add and one-based move badges", () => {
    const node: FieldDiff = {
      kind: "list",
      name: "layout",
      label: "Layout",
      type: "component",
      status: "changed",
      items: [
        {
          id: "1",
          componentType: "hero",
          status: "added",
          toIndex: 0,
          fields: [],
        },
        {
          id: "2",
          componentType: "cta",
          status: "unchanged",
          hasMoved: true,
          fromIndex: 1,
          toIndex: 0,
          fields: [],
        },
      ],
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("hero")).toBeInTheDocument();
    expect(screen.getByText("cta")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    // Engine indexes are zero-based; the badge reads them as human positions.
    expect(screen.getByText(/Moved 2/)).toBeInTheDocument();
  });

  it("recurses into a group", () => {
    const node: FieldDiff = {
      kind: "group",
      name: "seo",
      label: "SEO",
      type: "group",
      status: "changed",
      fields: [
        {
          kind: "value",
          name: "metaTitle",
          label: "Meta Title",
          type: "text",
          status: "changed",
          before: "Old",
          after: "New",
        },
      ],
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("Meta Title")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("renders both sides when a component swap reuses a field name", () => {
    // A dynamic-zone type swap emits a removed and an added node with the same
    // name as siblings; both must render (distinct keys, no collision).
    const node: FieldDiff = {
      kind: "group",
      name: "block",
      label: "Block",
      type: "group",
      status: "changed",
      fields: [
        {
          kind: "value",
          name: "body",
          label: "Body (was)",
          type: "text",
          status: "removed",
          before: "old body",
          after: null,
        },
        {
          kind: "value",
          name: "body",
          label: "Body (now)",
          type: "text",
          status: "added",
          before: null,
          after: "new body",
        },
      ],
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText("old body")).toBeInTheDocument();
    expect(screen.getByText("new body")).toBeInTheDocument();
  });

  it("marks a field no longer in the schema", () => {
    const node: FieldDiff = {
      kind: "unknown",
      name: "legacyKeyword",
      status: "removed",
      before: "seo term",
      after: null,
    };
    render(<FieldDiffNode node={node} fields={[]} />);

    expect(screen.getByText(/no longer in the schema/)).toBeInTheDocument();
    expect(screen.getByText("seo term")).toBeInTheDocument();
  });
});
