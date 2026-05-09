// Why: lock the per-type rendering matrix + the stale-default warning for
// select/radio. These were the regression behaviors we restored from the
// legacy GeneralPanel.
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

// Why: DefaultValueField is fully controlled — value comes from
// field.defaultValue. Uncontrolled tests where the parent never echoes
// the new value back leave the input visually empty between keystrokes
// (React reverts to the unchanged prop), so `userEvent.type("red,")`
// only ever calls onChange with single chars. This wrapper keeps the
// field in local state so type-then-assert works as expected.
function Controlled(props: {
  initial: BuilderField;
  onChange?: (value: BuilderField["defaultValue"]) => void;
}) {
  const [field, setField] = useState<BuilderField>(props.initial);
  return (
    <DefaultValueField
      field={field}
      onChange={v => {
        setField(prev => ({ ...prev, defaultValue: v }));
        props.onChange?.(v);
      }}
    />
  );
}

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

  // Why: PR E3 (Q8) replaced the legacy Switch with a tri-state radio
  // group (True / False / Unset) for checkbox / toggle / boolean. "Unset"
  // maps to onChange(null) so the parent strips the defaultValue key
  // entirely (locked decision: brainstorm 2026-05-04 Option B). The old
  // Switch-based test moved into this describe block.
  describe("tri-state boolean default (PR E3)", () => {
    const makeBoolField = (defaultValue?: boolean | null): BuilderField =>
      baseField({
        name: "isPublished",
        label: "Is Published",
        type: "boolean",
        ...(defaultValue !== undefined ? { defaultValue } : {}),
      });

    it("renders three radios (True / False / Unset) for boolean type", () => {
      render(<DefaultValueField field={makeBoolField()} onChange={vi.fn()} />);
      expect(
        screen.getByRole("radio", { name: /^true$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /^false$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /^unset$/i })
      ).toBeInTheDocument();
    });

    it("selects Unset when defaultValue is missing", () => {
      render(<DefaultValueField field={makeBoolField()} onChange={vi.fn()} />);
      expect(screen.getByRole("radio", { name: /^unset$/i })).toBeChecked();
      expect(screen.getByRole("radio", { name: /^true$/i })).not.toBeChecked();
      expect(screen.getByRole("radio", { name: /^false$/i })).not.toBeChecked();
    });

    it("selects False when defaultValue is the literal false", () => {
      render(
        <DefaultValueField field={makeBoolField(false)} onChange={vi.fn()} />
      );
      expect(screen.getByRole("radio", { name: /^false$/i })).toBeChecked();
    });

    it("selects True when defaultValue is the literal true", () => {
      render(
        <DefaultValueField field={makeBoolField(true)} onChange={vi.fn()} />
      );
      expect(screen.getByRole("radio", { name: /^true$/i })).toBeChecked();
    });

    it("calls onChange(true) when user picks True", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<DefaultValueField field={makeBoolField()} onChange={onChange} />);
      await user.click(screen.getByRole("radio", { name: /^true$/i }));
      expect(onChange).toHaveBeenLastCalledWith(true);
    });

    it("calls onChange(false) when user picks False", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(<DefaultValueField field={makeBoolField()} onChange={onChange} />);
      await user.click(screen.getByRole("radio", { name: /^false$/i }));
      expect(onChange).toHaveBeenLastCalledWith(false);
    });

    it("calls onChange(null) when user picks Unset (strips the key downstream)", async () => {
      const user = userEvent.setup();
      const onChange = vi.fn();
      render(
        <DefaultValueField field={makeBoolField(true)} onChange={onChange} />
      );
      await user.click(screen.getByRole("radio", { name: /^unset$/i }));
      expect(onChange).toHaveBeenLastCalledWith(null);
    });

    it("applies the same tri-state to checkbox and toggle types", () => {
      const checkboxField = makeBoolField();
      checkboxField.type = "checkbox";
      render(<DefaultValueField field={checkboxField} onChange={vi.fn()} />);
      expect(
        screen.getByRole("radio", { name: /^true$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /^false$/i })
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /^unset$/i })
      ).toBeInTheDocument();
    });

    it("disables all three radios when readOnly", () => {
      render(
        <DefaultValueField
          field={makeBoolField(true)}
          readOnly
          onChange={vi.fn()}
        />
      );
      expect(screen.getByRole("radio", { name: /^true$/i })).toBeDisabled();
      expect(screen.getByRole("radio", { name: /^false$/i })).toBeDisabled();
      expect(screen.getByRole("radio", { name: /^unset$/i })).toBeDisabled();
    });
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

  it("does not crash when select has an option with empty value (fresh option)", () => {
    // Why: Radix Select disallows empty-string SelectItem values. New
    // options in SelectOptionsEditor start with value === "" until the
    // user types. Default picker must filter those out, not crash.
    expect(() =>
      render(
        <DefaultValueField
          field={baseField({
            type: "select",
            options: [
              { label: "Apple", value: "a" },
              { label: "", value: "" },
            ],
          })}
          onChange={vi.fn()}
        />
      )
    ).not.toThrow();
  });

  it("preserves trailing commas while typing in chips default", async () => {
    // Why: regression for "comma key stuck" bug -- prior impl split+joined
    // on every keystroke, eating the trailing empty piece so the comma
    // never landed in the input. Now we store the raw text as-is and
    // normalize at runtime on read.
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <Controlled initial={baseField({ type: "chips" })} onChange={onChange} />
    );
    const input = screen.getByLabelText(/default value/i) as HTMLInputElement;
    await user.type(input, "red,");
    expect(onChange).toHaveBeenLastCalledWith("red,");
  });
});
