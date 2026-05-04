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
