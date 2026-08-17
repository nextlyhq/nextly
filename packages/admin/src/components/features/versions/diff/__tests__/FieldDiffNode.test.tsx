/**
 * The diff renderer must paint each node kind legibly: text as insert/delete
 * runs, scalars as before and after, relationships as added/removed chips,
 * lists item-by-item with their badges, and a dropped field as clearly gone.
 * Each value node carries its own display config, so cardinality and options
 * survive, and an unchanged value is never dressed up as an edit.
 */
import { describe, it, expect } from "vitest";

import { render, screen, within } from "@admin/__tests__/utils";
import type { FieldDiff } from "@admin/services/versionApi";

import { FieldDiffNode } from "../FieldDiffNode";

/**
 * The subtree holding one side of a comparison, found through the caption that
 * names it. Asserting inside a named column is what separates "both values are
 * somewhere on screen" from "each value is on its own side", which is the whole
 * claim a side-by-side layout makes.
 */
function column(side: "Before" | "After"): HTMLElement {
  const caption = screen.getByText(side);
  const cell = caption.parentElement;
  if (!cell) throw new Error(`the ${side} caption has no containing column`);
  return cell;
}

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
    render(<FieldDiffNode node={node} />);

    // Rendered once (a struck before plus an after would be two occurrences).
    expect(screen.getAllByText("unchanged-slug")).toHaveLength(1);
    expect(screen.getByText("Unchanged")).toBeInTheDocument();
  });

  it("uses the node's display config so a hasMany value keeps its items", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "scores",
      label: "Scores",
      type: "number",
      status: "changed",
      display: { hasMany: true },
      before: [1, 2],
      after: [1, 2, 3],
    };
    render(<FieldDiffNode node={node} />);

    // With hasMany the array renders its members; without it the value would
    // normalize to null and read "Not set".
    expect(screen.getByText("3")).toBeInTheDocument();
    expect(screen.queryByText(/Not set/)).not.toBeInTheDocument();
  });

  it("labels a select value from its display options", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "state",
      label: "State",
      type: "select",
      status: "changed",
      display: {
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "pub" },
        ],
      },
      before: "draft",
      after: "pub",
    };
    render(<FieldDiffNode node={node} />);

    // The option labels prove the display config drove rendering, not the codes.
    expect(screen.getByText("Draft")).toBeInTheDocument();
    expect(screen.getByText("Published")).toBeInTheDocument();
  });

  it("labels before and after for assistive technology", () => {
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

    // Which column a value sits in is not perceivable to a screen reader, so
    // each side names itself.
    expect(screen.getByText(/^Before/)).toBeInTheDocument();
    expect(screen.getByText(/^After/)).toBeInTheDocument();
  });

  it("puts each side of a changed scalar in its own column", () => {
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

    // Both values being on screen is what the older stacked layout also did.
    // The claim here is stronger: the old value is in the older version's
    // column and nowhere else.
    expect(within(column("Before")).getByText("1")).toBeInTheDocument();
    expect(within(column("Before")).queryByText("2")).toBeNull();
    expect(within(column("After")).getByText("2")).toBeInTheDocument();
    expect(within(column("After")).queryByText("1")).toBeNull();
  });

  it("distributes a changed text field's runs to the side each reaches", () => {
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

    // A deletion belongs to the older version only, an insertion to the newer
    // only, and the common run to both — so it appears in each column.
    expect(within(column("Before")).getByText("world").tagName).toBe("DEL");
    expect(within(column("Before")).queryByText("there")).toBeNull();
    expect(within(column("After")).getByText("there").tagName).toBe("INS");
    expect(within(column("After")).queryByText("world")).toBeNull();
    expect(screen.getAllByText("Hello")).toHaveLength(2);
  });

  it("says a field was not present on the side it did not reach", () => {
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

    // An added field HAS a before column, and leaving it blank would read the
    // same as a field that existed and held nothing.
    expect(
      within(column("Before")).getByText("Not present")
    ).toBeInTheDocument();
    expect(within(column("After")).getByText("brand new")).toBeInTheDocument();
    expect(screen.getByText("Added")).toBeInTheDocument();
  });

  it("says a removed field is not present on the newer side", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "note",
      label: "Note",
      type: "text",
      status: "removed",
      before: "was here",
      after: null,
    };
    render(<FieldDiffNode node={node} />);

    expect(within(column("Before")).getByText("was here")).toBeInTheDocument();
    expect(
      within(column("After")).getByText("Not present")
    ).toBeInTheDocument();
    expect(screen.getByText("Removed")).toBeInTheDocument();
  });

  it("spans an unchanged field across both columns rather than repeating it", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "slug",
      label: "Slug",
      type: "text",
      status: "unchanged",
      before: "same-slug",
      after: "same-slug",
    };
    render(<FieldDiffNode node={node} />);

    // No columns at all for an unchanged node: two of them would print the same
    // value twice and say nothing the badge has not.
    expect(screen.queryByText("Before")).toBeNull();
    expect(screen.queryByText("After")).toBeNull();
    expect(screen.getAllByText("same-slug")).toHaveLength(1);
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
    render(<FieldDiffNode node={node} />);

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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("Meta Title")).toBeInTheDocument();
    expect(screen.getByText("Old")).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
  });

  it("shows the component type transition for a dynamic-zone swap", () => {
    // A swap with no field values still tells the user what changed.
    const node: FieldDiff = {
      kind: "group",
      name: "block",
      label: "Block",
      type: "component",
      status: "changed",
      componentTypeBefore: "hero",
      componentTypeAfter: "cta",
      fields: [],
    };
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText(/hero/)).toBeInTheDocument();
    expect(screen.getByText(/cta/)).toBeInTheDocument();
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
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("old body")).toBeInTheDocument();
    expect(screen.getByText("new body")).toBeInTheDocument();
  });

  it("marks a field no longer in the schema without exposing its value", () => {
    const node: FieldDiff = {
      kind: "unknown",
      name: "legacyKeyword",
      status: "removed",
    };
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText("legacyKeyword")).toBeInTheDocument();
    expect(screen.getByText(/Value hidden/)).toBeInTheDocument();
  });

  it("shows the component type transition on a swapped list item", () => {
    const node: FieldDiff = {
      kind: "list",
      name: "blocks",
      label: "Blocks",
      type: "component",
      status: "changed",
      items: [
        {
          id: "1",
          componentType: "cta",
          componentTypeBefore: "hero",
          componentTypeAfter: "cta",
          status: "changed",
          fields: [],
        },
      ],
    };
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText(/hero/)).toBeInTheDocument();
    expect(screen.getByText(/cta/)).toBeInTheDocument();
  });

  it("hides the value of a dropped field", () => {
    // A field gone from the schema has no verifiable access rule, so its value
    // is withheld; only that it changed is shown.
    const node: FieldDiff = {
      kind: "unknown",
      name: "salary",
      status: "changed",
    };
    render(<FieldDiffNode node={node} />);

    expect(screen.getByText(/Value hidden/)).toBeInTheDocument();
    expect(screen.getByText("Changed")).toBeInTheDocument();
  });

  it("renders a stored JSON null rather than treating it as empty", () => {
    const node: FieldDiff = {
      kind: "value",
      name: "meta",
      label: "Meta",
      type: "json",
      status: "unchanged",
      before: null,
      after: null,
    };
    render(<FieldDiffNode node={node} />);

    // A json field can hold the primitive null; it must read as `null`, not the
    // "Not set" placeholder used for an absent value.
    expect(screen.getByText("null")).toBeInTheDocument();
    expect(screen.queryByText(/Not set/)).not.toBeInTheDocument();
  });

  it("says there is no change for an unchanged relationship set", () => {
    const node: FieldDiff = {
      kind: "set",
      name: "tags",
      label: "Tags",
      type: "relationship",
      status: "unchanged",
      added: [],
      removed: [],
    };
    render(<FieldDiffNode node={node} />);

    // With "Changed only" off an unchanged set carries no targets; it says so
    // rather than leaving a blank body under the "Unchanged" badge.
    expect(screen.getByText("No change")).toBeInTheDocument();
  });
});
