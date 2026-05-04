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
  it("renders all 5 system field names (title, slug, id, createdAt, updatedAt)", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.getByText("title")).toBeInTheDocument();
    expect(screen.getByText("slug")).toBeInTheDocument();
    expect(screen.getByText("id")).toBeInTheDocument();
    expect(screen.getByText("createdAt")).toBeInTheDocument();
    expect(screen.getByText("updatedAt")).toBeInTheDocument();
  });

  it("renders the 'System Fields' label above the box", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.getByText(/^System Fields$/)).toBeInTheDocument();
  });

  it("renders a Hide button (PR G alert-style)", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.getByRole("button", { name: /^hide$/i })).toBeInTheDocument();
  });

  it("renders no per-row buttons -- the system fields are inert", () => {
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={vi.fn()}
      />
    );
    expect(screen.queryByRole("button", { name: /^title$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^slug$/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /^id$/i })).toBeNull();
  });

  it("invokes onSetVisible(false) when the Hide button is clicked", async () => {
    const user = userEvent.setup();
    const onSetVisible = vi.fn();
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={onSetVisible}
      />
    );
    await user.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(onSetVisible).toHaveBeenCalledWith(false);
  });

  it("broadcasts via window event so the Settings modal switch stays in sync", async () => {
    const user = userEvent.setup();
    const handler = vi.fn();
    window.addEventListener("builder:show-system-fields", handler);
    render(
      <SystemFieldsRow
        systemFields={[titleField, slugField]}
        onSetVisible={vi.fn()}
      />
    );
    await user.click(screen.getByRole("button", { name: /^hide$/i }));
    expect(handler).toHaveBeenCalled();
    const evt = handler.mock.lastCall?.[0] as CustomEvent<boolean>;
    expect(evt.detail).toBe(false);
    window.removeEventListener("builder:show-system-fields", handler);
  });
});
