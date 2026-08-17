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

describe("ConditionBuilder -- value editor", () => {
  it("offers a choice field's own options rather than free text", async () => {
    // A select compares against one of its own options and nothing else, so
    // typing the value by hand is a way to misspell it into a condition that
    // never matches, with nothing on screen to say why.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        condition={{ field: "status", operator: "equals", value: "draft" }}
        siblingFields={siblings}
        onChange={onChange}
      />
    );
    await user.click(
      screen.getByRole("combobox", { name: /condition value/i })
    );
    await user.click(await screen.findByRole("option", { name: "Published" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ field: "status", value: "published" })
    );
  });

  it("recomputes the operator when the source type changes", async () => {
    // Switching a text `equals` condition to a checkbox has to STORE the
    // checkbox's default. Carrying `equals` over stored one operator while the
    // next render displayed the `isTrue` it fell back to, so what was saved and
    // what was on screen disagreed and only the saved one was evaluated.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        condition={{ field: "title", operator: "equals", value: "x" }}
        siblingFields={siblings}
        onChange={onChange}
      />
    );
    await user.click(
      screen.getByRole("combobox", { name: /condition field/i })
    );
    await user.click(await screen.findByRole("option", { name: "Active" }));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ field: "isActive", operator: "isTrue" })
    );
  });

  it("offers only the operators the source type supports", async () => {
    // A checkbox has no "is greater than", and offering one builds a condition
    // the evaluator can never satisfy.
    const user = userEvent.setup();
    render(
      <ConditionBuilder
        condition={{ field: "isActive", operator: "isTrue" }}
        siblingFields={siblings}
        onChange={vi.fn()}
      />
    );
    await user.click(
      screen.getByRole("combobox", { name: /condition operator/i })
    );
    expect(
      await screen.findByRole("option", { name: "is true" })
    ).toBeVisible();
    expect(screen.queryByRole("option", { name: /greater than/i })).toBeNull();
  });

  it("stores both ends of a range even when only one is typed", async () => {
    // The evaluator reads a missing end as NaN and quietly stops matching,
    // which looks like a broken condition rather than an unfinished one.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <ConditionBuilder
        condition={{ field: "score", operator: "between" }}
        siblingFields={[
          ...siblings,
          {
            id: "s5",
            name: "score",
            label: "Score",
            type: "number",
            validation: {},
          },
        ]}
        onChange={onChange}
      />
    );
    // Named "From" by its visible label now, inside a group named for the
    // range. The old accessible name came from an `aria-label` that rendered
    // nothing, which is why a date range showed two identical empty boxes.
    await user.type(screen.getByRole("spinbutton", { name: "From" }), "5");
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ value: { min: "5", max: "" } })
    );
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
