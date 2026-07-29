/**
 * The diff renderer must paint each node kind legibly: text as insert/delete
 * runs, scalars as before and after, relationships as added/removed chips,
 * lists item-by-item with their badges, and a dropped field as clearly gone.
 */
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
    render(<FieldDiffNode node={node} />);

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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("2")).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
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
    render(<FieldDiffNode node={node} />);

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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("c")).toBeInTheDocument();
    expect(screen.getByText("a")).toBeInTheDocument();
  });

  it("renders list items with add and move badges", () => {
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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("hero")).toBeInTheDocument();
    expect(screen.getByText("cta")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
    expect(screen.getByText(/Moved/)).toBeInTheDocument();
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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("Meta Title")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("marks a field no longer in the schema", () => {
    const node: FieldDiff = {
      kind: "unknown",
      name: "legacyKeyword",
      status: "removed",
      before: "seo term",
      after: null,
    };
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText(/no longer in the schema/)).toBeInTheDocument();
    expect(screen.getByText("seo term")).toBeInTheDocument();
  });
});
