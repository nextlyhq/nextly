// @vitest-environment jsdom

/**
 * The decision that withholds the panel, and the grouping it draws when it does
 * not.
 *
 * `takeoverLayout.test` covers which fields come back; this covers what is done
 * with them. The two are worth keeping apart because only one of them is about
 * blankness: a correct field list still produced an empty panel for as long as
 * something rendered it unconditionally.
 *
 * @module components/entries/EntryForm/EntryFieldsPanel.test
 */
import { render, screen } from "@testing-library/react";
import type { FieldConfig } from "nextly/config";
import { describe, expect, it, vi } from "vitest";

/*
 * The field renderer is replaced, not rendered. What is under test is which
 * fields reach it and how they are grouped; drawing fifteen real input types
 * would make this a test of the field renderer, which has its own.
 */
vi.mock("./EntryFormContent", () => ({
  EntryFormContent: ({ fields }: { fields: FieldConfig[] }) => (
    <span>{fields.map(f => f.name).join(",")}</span>
  ),
}));

const { fieldsBesidePanel } = await import("./EntryFieldsPanel");

const field = (name: string, type = "text") => ({ name, type }) as FieldConfig;

/** A collection shaped the way a Pages collection usually is. */
const minimal = [field("title"), field("slug"), field("body", "blocks")];

describe("the panel a takeover surface offers back", () => {
  it("answers NULL when the asking field is all there is", () => {
    /*
     * The state that must withhold the panel. A collection declaring only the
     * builder field has nothing to give back — not even an identity, because
     * this fixture has none — and an element here would be offered, opened and
     * blank.
     */
    expect(fieldsBesidePanel([field("body", "blocks")], "body")).toBeNull();
  });

  it("answers null outside any field it recognises, rather than an empty shell", () => {
    // An excludePath naming nothing still has to answer honestly about what is
    // left. Here that is the whole (empty) list.
    expect(fieldsBesidePanel([], "body")).toBeNull();
  });

  it("draws the document's identity, which is what the minimal shape has", () => {
    /*
     * The defect, from the other side. Title and slug were stripped as system
     * fields, so this exact collection produced nothing at all — while being
     * the shape most Pages collections take, and while the builder covering the
     * form is what removed the header that draws them.
     */
    const panel = fieldsBesidePanel(minimal, "body");
    expect(panel).not.toBeNull();
    render(<div data-testid="host">{panel}</div>);

    expect(screen.getByTestId("host").textContent).toContain("title,slug");
  });

  it("labels the groups rather than running them together", () => {
    // The grouping is the reason the panel is readable at all: a slug sorted in
    // among a collection's own relations lands in an order an author cannot
    // anticipate.
    render(
      <div>{fieldsBesidePanel([...minimal, field("summary")], "body")}</div>
    );

    expect(screen.getByText("Page")).toBeDefined();
    expect(screen.getByText("Fields")).toBeDefined();
  });

  it("omits a group that has nothing in it, heading and all", () => {
    /*
     * A labelled region containing nothing is the same failure as the panel
     * itself being blank, one level down — so the heading has to go with its
     * fields. This collection declares no fields of its own.
     */
    render(<div>{fieldsBesidePanel(minimal, "body")}</div>);

    expect(screen.getByText("Page")).toBeDefined();
    expect(screen.queryByText("Fields")).toBeNull();
  });

  it("keeps the collection's own fields out of the identity group", () => {
    // The control for the grouping. One `EntryFormContent` handed every field
    // would satisfy every assertion above about content being present.
    render(
      <div data-testid="host">
        {fieldsBesidePanel([...minimal, field("summary")], "body")}
      </div>
    );

    const text = screen.getByTestId("host").textContent ?? "";
    expect(text).toContain("title,slug");
    expect(text).toContain("summary");
    // Never as one list: that spelling is what a merged panel would produce.
    expect(text).not.toContain("title,slug,summary");
  });
});
