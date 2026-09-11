import { DndContext } from "@dnd-kit/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { describe, it, expect, vi } from "vitest";

import type { BuilderField } from "../../types";
import { NestedFieldGroup } from "../NestedFieldGroup";

const noop = () => undefined;

function renderInDnd(ui: React.ReactNode) {
  return render(<DndContext>{ui}</DndContext>);
}

// Why: give label and name distinct values so getByText queries don't match
// both the label and the mono-name subtitle.
const childField = (
  id: string,
  name: string,
  label?: string
): BuilderField => ({
  id,
  name,
  label: label ?? `${name.charAt(0).toUpperCase()}${name.slice(1)} Field`,
  type: "text",
  validation: {},
});

describe("NestedFieldGroup", () => {
  it("renders the +Add button alone when there are no children", () => {
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "heroSections",
          label: "Hero Sections",
          type: "repeater",
          validation: {},
          fields: [],
        }}
        onEditField={noop}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: /add field inside hero sections/i })
    ).toBeInTheDocument();
    // Why: Q7 -- empty state is the +Add button alone, no copy.
    expect(screen.queryByText(/no nested fields|add fields/i)).toBeNull();
  });

  it("renders each child as a clickable row", async () => {
    const onEdit = vi.fn();
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "heroSections",
          label: "Hero Sections",
          type: "repeater",
          validation: {},
          fields: [childField("c1", "title"), childField("c2", "image")],
        }}
        onEditField={onEdit}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={noop}
      />
    );
    await userEvent.click(screen.getByText("Title Field"));
    expect(onEdit).toHaveBeenCalledWith("c1");
  });

  it("names each child's handle for what the child is called, or that it is unnamed", () => {
    // 🔴 The handle read `field.name`, so a child just added -- no label and
    // no name yet -- had a handle called "Reorder " and a drag that announced
    // nothing. It now says the same subject the announcement says: the label
    // the card shows, else the name, else that the field is unnamed.
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "heroSections",
          label: "Hero Sections",
          type: "repeater",
          validation: {},
          fields: [childField("c1", "title"), childField("c2", "", "")],
        }}
        onEditField={noop}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={noop}
      />
    );
    expect(
      screen
        .getAllByRole("button", { name: /^Reorder / })
        .map(handle => handle.getAttribute("aria-label"))
    ).toEqual(["Reorder Title Field", "Reorder an unnamed field"]);
  });

  it("calls onAddInsideParent with the parent's id when +Add is clicked", async () => {
    const onAdd = vi.fn();
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "heroSections",
          label: "Hero Sections",
          type: "repeater",
          validation: {},
          fields: [],
        }}
        onEditField={noop}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={onAdd}
      />
    );
    await userEvent.click(
      screen.getByRole("button", { name: /add field inside hero sections/i })
    );
    expect(onAdd).toHaveBeenCalledWith("p1");
  });

  it("recursively renders nested children when a child is itself a repeater", () => {
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "outer",
          label: "Outer",
          type: "repeater",
          validation: {},
          fields: [
            {
              id: "c1",
              name: "inner",
              label: "Inner",
              type: "repeater",
              validation: {},
              fields: [childField("g1", "deepText")],
            },
          ],
        }}
        onEditField={noop}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: /add field inside outer/i })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add field inside inner/i })
    ).toBeInTheDocument();
    expect(screen.getByText("DeepText Field")).toBeInTheDocument();
  });

  it("does NOT recursively expand when child is a component (Q4 leaf)", () => {
    renderInDnd(
      <NestedFieldGroup
        parentField={{
          id: "p1",
          name: "outer",
          label: "Outer",
          type: "repeater",
          validation: {},
          fields: [
            {
              id: "c1",
              name: "seoBlock",
              label: "SEO Block",
              type: "component",
              component: "seo-block",
              validation: {},
            },
          ],
        }}
        onEditField={noop}
        onDeleteField={noop}
        onDuplicateField={noop}
        onAddInsideParent={noop}
      />
    );
    expect(
      screen.getByRole("button", { name: /add field inside outer/i })
    ).toBeInTheDocument();
    // Component child renders (mono-name subtitle is fine), but no +Add
    // inside it.
    expect(screen.getAllByText("seoBlock").length).toBeGreaterThan(0);
    expect(
      screen.queryByRole("button", { name: /add field inside seoblock/i })
    ).toBeNull();
  });
});
