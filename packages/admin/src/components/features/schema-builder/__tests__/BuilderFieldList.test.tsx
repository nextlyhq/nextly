// Why: BuilderFieldList renders the WYSIWYG layout — Built-in group up top
// (title + slug as locked rows, infrastructure rows behind a toggle),
// user fields packed into rows by width below, and an empty state when
// there are no user fields. Drag-and-drop wiring is the parent page's
// job (it owns the DndContext); these tests cover rendering, packing,
// and empty/locked states.
import userEvent from "@testing-library/user-event";
import { DndContext } from "@dnd-kit/core";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { BuilderFieldList } from "../BuilderFieldList";
import type { BuilderField } from "../types";

function withDndContext(node: React.ReactNode) {
  // SortableRow uses useSortable which requires a DndContext ancestor.
  return <DndContext>{node}</DndContext>;
}

const sysTitle: BuilderField = {
  id: "system_title",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: true,
  validation: { required: true },
  admin: { width: "100%" },
};
const sysSlug: BuilderField = {
  id: "system_slug",
  name: "slug",
  label: "Slug",
  type: "text",
  isSystem: true,
  validation: { required: true },
  admin: { width: "100%" },
};
const u1: BuilderField = {
  id: "u1",
  name: "first_name",
  label: "First name",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "50%" },
};
const u2: BuilderField = {
  id: "u2",
  name: "last_name",
  label: "Last name",
  type: "text",
  isSystem: false,
  validation: {},
  admin: { width: "50%" },
};
const u3: BuilderField = {
  id: "u3",
  name: "bio",
  label: "Bio",
  type: "richText",
  isSystem: false,
  validation: {},
  admin: { width: "100%" },
};

describe("BuilderFieldList", () => {
  it("renders the System Fields row with title + slug as inert chips + the Hide button", () => {
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    // PR D renamed the group from "Built in" to "System Fields" and made
    // every system row an inert chip (no role="button", no onClick).
    // PR G (feedback 2) wraps the chips in a bordered box with an
    // alert-style "Hide" button positioned top-right inside the box.
    expect(screen.getByText(/system fields/i)).toBeInTheDocument();
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("slug")).toBeInTheDocument();
    // System chips are not buttons.
    expect(screen.queryByRole("button", { name: /^title$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^slug$/i })).toBeNull();
    // Default ON; visible toggle is the alert-style "Hide" button.
    expect(screen.getByRole("button", { name: /^hide$/i })).toBeInTheDocument();
  });

  it("packs user fields with widths summing to <= 100 into one row", () => {
    const { container } = render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug, u1, u2]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    // Sortable user rows carry data-row-id="row-N"; system rows carry
    // data-row-id starting with "system-".
    const userRows = container.querySelectorAll('[data-row-id^="row-"]');
    expect(userRows.length).toBe(1);
  });

  it("wraps user fields whose widths exceed 100 into separate rows", () => {
    const { container } = render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug, u1, u2, u3]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    const userRows = container.querySelectorAll('[data-row-id^="row-"]');
    // Row 1: u1 + u2 (50 + 50). Row 2: u3 (100).
    expect(userRows.length).toBe(2);
  });

  it("renders the empty state when no user fields exist", () => {
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    expect(screen.getByText(/no custom fields yet/i)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /add your first field/i })
    ).toBeInTheDocument();
  });

  it("invokes onAddAt(0) when the empty-state button is clicked", async () => {
    const user = userEvent.setup();
    const onAddAt = vi.fn();
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug]}
          onAddAt={onAddAt}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    await user.click(screen.getByRole("button", { name: /add your first/i }));
    expect(onAddAt).toHaveBeenCalledWith(0);
  });

  it("hides the Add field button and per-card Delete in readOnly mode", () => {
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug, u1]}
          readOnly
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    expect(
      screen.queryByRole("button", { name: /\+ add field/i })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete first_name/i })
    ).not.toBeInTheDocument();
  });

  it("renders ONE '+ Add field' button (centered+bordered box, bottom only) when fields exist", () => {
    // Why: PR H feedback 2.2 -- dropped the top header button; the
    // bottom centered/bordered affordance is the single + Add field
    // location now. Replaces the two-button arrangement from PR D.
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug, u1]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    const addButtons = screen.getAllByRole("button", {
      name: /\+ add field/i,
    });
    expect(addButtons).toHaveLength(1);
  });

  it("does not render any '+ Add field' button on the empty state", () => {
    // Why: PR H feedback 2.2 -- both the top header button and the
    // bottom centered/bordered box are gone on the empty state. The
    // EmptyState component owns the "Add your first field" CTA there.
    render(
      withDndContext(
        <BuilderFieldList
          fields={[sysTitle, sysSlug]}
          onAddAt={vi.fn()}
          onEditField={vi.fn()}
          onDeleteField={vi.fn()}
          onDuplicateField={vi.fn()}
          onReorder={vi.fn()}
        />
      )
    );
    expect(screen.queryByRole("button", { name: /\+ add field/i })).toBeNull();
    // The empty-state CTA is still there.
    expect(
      screen.getByRole("button", { name: /add your first field/i })
    ).toBeInTheDocument();
  });
});
