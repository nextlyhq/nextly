// Why: the Conditions tab holds a field's condition on a field beside it, on
// a surface whose conditions work that way, and says so plainly on a surface
// whose fields take none, rather than standing empty.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "@admin/components/features/schema-builder/types";
import { ConditionsTab } from "../ConditionsTab";

const field: BuilderField = {
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  validation: {},
};

const sibling: BuilderField = {
  id: "s1",
  name: "status",
  label: "Status",
  type: "text",
  validation: {},
};

describe("ConditionsTab", () => {
  it("offers to add a condition, with no condition editor until one is added", () => {
    render(
      <ConditionsTab
        field={field}
        siblings={[sibling]}
        conditions="sibling"
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /\+ add condition/i })
    ).toBeInTheDocument();
    expect(screen.queryByText(/^Source field$/i)).toBeNull();
    // The visual builder, not the JSON textarea it replaced.
    expect(
      screen.queryByPlaceholderText(/"field": "status"/i)
    ).not.toBeInTheDocument();
  });

  it("seeds an empty condition when Add condition is clicked", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionsTab
        field={field}
        siblings={[]}
        conditions="sibling"
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("button", { name: /\+ add condition/i }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.condition).toEqual({
      field: "",
      operator: "equals",
      value: "",
    });
  });

  it("says fields take no conditions on a surface without them", () => {
    render(
      <ConditionsTab
        field={field}
        siblings={[sibling]}
        conditions="none"
        onChange={vi.fn()}
      />
    );
    expect(screen.getByText(/take no conditions/i)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /add condition/i })).toBeNull();
  });
});
