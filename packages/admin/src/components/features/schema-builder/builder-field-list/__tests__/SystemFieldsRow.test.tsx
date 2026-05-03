// Why: PR D collapses the 2-row "Built in" group into a single
// horizontal row labeled "System Fields" containing all 5 reserved
// names (title, slug, id, createdAt, updatedAt). Fully locked: no
// click handlers, no per-row badges, no editor opens.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { SystemFieldsRow } from "../SystemFieldsRow";

const titleField: BuilderField = {
  id: "system_title",
  name: "title",
  label: "Title",
  type: "text",
  isSystem: true,
  validation: { required: true },
};
const slugField: BuilderField = {
  id: "system_slug",
  name: "slug",
  label: "Slug",
  type: "text",
  isSystem: true,
  validation: {},
};

describe("SystemFieldsRow", () => {
  it("renders title and slug names plus the 3 synthesized internals when shown", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        showInternals
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("slug")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("createdAt")).toBeInTheDocument();
    expect(screen.getByText("updatedAt")).toBeInTheDocument();
  });

  it("hides the 3 internals when showInternals=false (only title + slug)", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        showInternals={false}
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("slug")).toBeInTheDocument();
    expect(screen.queryByText("id")).toBeNull();
    expect(screen.queryByText("createdAt")).toBeNull();
    expect(screen.queryByText("updatedAt")).toBeNull();
  });

  it("renders no per-row buttons -- the system fields are inert", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        showInternals
        onSetVisible={vi.fn()}
      />
    );
    // Whatever buttons exist (e.g., the dismiss X) must NOT be one
    // labeled with a field name -- the rows themselves are not buttons.
    expect(screen.queryByRole("button", { name: /^title$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^slug$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^id$/i })).toBeNull();
  });

  it("calls onSetVisible(false) when the inline X dismiss is clicked", async () => {
    const user = userEvent.setup();
    const onSetVisible = vi.fn();
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        showInternals
        onSetVisible={onSetVisible}
      />
    );
    await user.click(screen.getByLabelText(/hide system fields/i));
    expect(onSetVisible).toHaveBeenCalledWith(false);
  });

  it("shows a 'Show system fields' toggle when showInternals=false", async () => {
    const user = userEvent.setup();
    const onSetVisible = vi.fn();
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        showInternals={false}
        onSetVisible={onSetVisible}
      />
    );
    const showButton = screen.getByRole("button", {
      name: /show system fields/i,
    });
    await user.click(showButton);
    expect(onSetVisible).toHaveBeenCalledWith(true);
  });
});
