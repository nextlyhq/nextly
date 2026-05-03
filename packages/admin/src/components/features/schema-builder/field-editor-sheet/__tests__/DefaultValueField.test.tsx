// Why: lock the per-type rendering matrix + the stale-default warning for
// select/radio. These were the regression behaviors we restored from the
// legacy GeneralPanel.
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import type { BuilderField } from "../../types";
import { DefaultValueField } from "../DefaultValueField";

const baseField = (overrides: Partial<BuilderField> = {}): BuilderField => ({
  id: "f1",
  name: "title",
  label: "Title",
  type: "text",
  validation: {},
  ...overrides,
});

describe("DefaultValueField", () => {
  it("renders nothing for relationship type", () => {
    const { container } = render(
      <DefaultValueField
        field={baseField({ type: "relationship" })}
        onChange={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });

  it("renders nothing for upload, repeater, group, component, blocks, password", () => {
    for (const type of [
      "upload",
      "repeater",
      "group",
      "component",
      "blocks",
      "password",
    ]) {
      const { container, unmount } = render(
        <DefaultValueField field={baseField({ type })} onChange={vi.fn()} />
      );
      expect(container.firstChild).toBeNull();
      unmount();
    }
  });

  it("renders a text input for type=text and propagates onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DefaultValueField field={baseField()} onChange={onChange} />);
    const input = screen.getByLabelText(/default value/i);
    await user.type(input, "hi");
    expect(onChange).toHaveBeenCalledWith("h");
    expect(onChange).toHaveBeenLastCalledWith("i");
  });

  it("renders a number input for type=number and emits null when emptied", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DefaultValueField
        field={baseField({ type: "number", defaultValue: 5 })}
        onChange={onChange}
      />
    );
    const input = screen.getByLabelText(/default value/i) as HTMLInputElement;
    await user.clear(input);
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it("renders a switch for type=checkbox and toggles", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DefaultValueField
        field={baseField({ type: "checkbox", defaultValue: false })}
        onChange={onChange}
      />
    );
    const sw = screen.getByRole("switch");
    await user.click(sw);
    expect(onChange).toHaveBeenLastCalledWith(true);
  });

  it("shows the selected option's label for type=select", () => {
    render(
      <DefaultValueField
        field={baseField({
          type: "select",
          defaultValue: "a",
          options: [
            { label: "Apple", value: "a" },
            { label: "Banana", value: "b" },
          ],
        })}
        onChange={vi.fn()}
      />
    );
    // The Radix SelectValue renders the matched option's label inside the
    // trigger — options themselves are in a Portal and not in the DOM
    // until the dropdown opens.
    expect(screen.getByText("Apple")).toBeInTheDocument();
  });

  it("warns when select default refers to a missing option", () => {
    render(
      <DefaultValueField
        field={baseField({
          type: "select",
          defaultValue: "ghost",
          options: [{ label: "Apple", value: "a" }],
        })}
        onChange={vi.fn()}
      />
    );
    expect(
      screen.getByText(/no longer matches any option/i)
    ).toBeInTheDocument();
  });

  it("renders nothing when select has no defined options yet", () => {
    const { container } = render(
      <DefaultValueField
        field={baseField({ type: "select", options: [] })}
        onChange={vi.fn()}
      />
    );
    expect(container.firstChild).toBeNull();
  });
});
