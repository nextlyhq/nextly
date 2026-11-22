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
  it("says why a condition is broken, and offers to remove it", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // It reads "summary", which is not beside it any more.
    const gatedField: BuilderField = {
      ...field,
      admin: {
        condition: { field: "summary", operator: "equals", value: "x" },
      },
    };
    render(
      <ConditionsTab
        field={gatedField}
        siblings={[sibling]}
        conditions="sibling"
        onChange={onChange}
      />
    );
    expect(
      screen.getByText(
        "Title's condition reads summary, which is no longer beside it. Choose another field for it, or remove the condition."
      )
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Remove" }));
    const last = onChange.mock.lastCall?.[0] as BuilderField;
    expect(last.admin?.condition).toBeUndefined();
  });

  it("says nothing of a condition that still reads its source", () => {
    const gatedField: BuilderField = {
      ...field,
      admin: { condition: { field: "status", operator: "equals", value: "x" } },
    };
    render(
      <ConditionsTab
        field={gatedField}
        siblings={[sibling]}
        conditions="sibling"
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByText(/no longer/)).toBeNull();
  });

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
    // The conditions builder, not the JSON textarea it replaced.
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
