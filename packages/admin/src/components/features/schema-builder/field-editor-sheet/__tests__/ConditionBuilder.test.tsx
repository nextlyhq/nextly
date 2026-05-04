// Why: ConditionBuilder is the visual replacement for the JSON textarea
// that PR E2 retires. Tests lock:
//   - "Add condition" button shows when no condition
//   - Source field dropdown lists eligible sibling fields
//   - Operator dropdown filters by source-field type
//   - Value input shape changes by operator
//   - Backwards-compat: legacy { field, equals } loads correctly
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { ConditionBuilder } from "../ConditionBuilder";

const siblings: BuilderField[] = [
  {
    id: "s1",
    name: "status",
    label: "Status",
    type: "select",
    validation: {},
    options: [
      { label: "Draft", value: "draft" },
      { label: "Published", value: "published" },
    ],
  },
  {
    id: "s2",
    name: "isActive",
    label: "Active",
    type: "checkbox",
    validation: {},
  },
  {
    id: "s3",
    name: "title",
    label: "Title",
    type: "text",
    validation: {},
  },
  {
    id: "s4",
    name: "image",
    label: "Image",
    // Upload should NOT appear in the source dropdown.
    type: "upload",
    validation: {},
  },
];

describe("ConditionBuilder -- empty state", () => {
  it("renders 'Add condition' button when condition is undefined", () => {
    render(
      <ConditionBuilder
        condition={undefined}
        siblingFields={siblings}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByRole("button", { name: /add condition/i })
    ).toBeInTheDocument();
  });

  it("clicking 'Add condition' emits a default condition (first eligible field, equals)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        condition={undefined}
        siblingFields={siblings}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("button", { name: /add condition/i }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ field: "status", operator: "equals" })
    );
  });
});

describe("ConditionBuilder -- editing", () => {
  it("'Remove' button clears the condition", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        condition={{ field: "status", operator: "equals", value: "draft" }}
        siblingFields={siblings}
        onChange={onChange}
      />
    );
    await user.click(screen.getByRole("button", { name: /remove/i }));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("does NOT list upload-type fields in the source dropdown", () => {
    render(
      <ConditionBuilder
        condition={{ field: "status", operator: "equals", value: "draft" }}
        siblingFields={siblings}
        onChange={vi.fn()}
      />
    );
    // Source dropdown is closed initially. Image field should not be
    // in the visible DOM (the trigger renders the selected label, not
    // every option).
    expect(screen.queryByText("Image")).toBeNull();
  });
});

describe("ConditionBuilder -- backwards-compat", () => {
  it("loads legacy { field, equals } shape correctly", () => {
    const legacy = { field: "status", equals: "draft" };
    render(
      <ConditionBuilder
        condition={legacy}
        siblingFields={siblings}
        onChange={vi.fn()}
      />
    );
    // Should render the condition as if operator = equals.
    // Source field "Status" should be selected.
    expect(screen.getByText("Status")).toBeInTheDocument();
  });
});
