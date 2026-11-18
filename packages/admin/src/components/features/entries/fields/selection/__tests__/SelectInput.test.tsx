/**
 * SelectInput.isClearable wiring test.
 *
 * Pins the contract that:
 *  - An optional field offers to clear unless `admin.isClearable === false`,
 *    matching the builder's Clearable switch, which is drawn ON when unset.
 *  - A required field never offers to clear: "none" is not an answer it takes.
 *  - With a value, the clear button renders next to the trigger and clicking
 *    it resets the value.
 *  - When the value is empty (or null/undefined), the clear button stays
 *    hidden — there's nothing to clear.
 *  - disabled / readOnly suppress the button so it can't be clicked.
 *
 * Regression coverage for the wiring gap where `isClearable` lived on the
 */
import type { RadioFieldConfig, SelectFieldConfig } from "nextly/config";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { RadioInput } from "../RadioInput";
import { SelectInput } from "../SelectInput";

function Harness({
  field,
  defaultValue = "",
  disabled,
  readOnly,
}: {
  field: SelectFieldConfig;
  defaultValue?: string;
  disabled?: boolean;
  readOnly?: boolean;
}) {
  const methods = useForm({ defaultValues: { color: defaultValue } });
  return (
    <FormProvider {...methods}>
      <SelectInput
        name="color"
        field={field}
        control={methods.control}
        disabled={disabled}
        readOnly={readOnly}
      />
    </FormProvider>
  );
}

const baseField: SelectFieldConfig = {
  type: "select",
  name: "color",
  options: [
    { label: "Red", value: "red" },
    { label: "Blue", value: "blue" },
  ],
};

describe("SelectInput — isClearable knob", () => {
  // 🔴 The builder draws Clearable ON for a field that never set it, and the
  // form read the same unset value as OFF: an optional select the builder
  // called clearable could not be emptied once a value was picked.
  it("offers to clear an optional field that never set Clearable", () => {
    render(<Harness field={baseField} defaultValue="red" />);
    expect(
      screen.getByRole("button", { name: /clear selection/i })
    ).toBeInTheDocument();
  });

  it("does not offer to clear once Clearable is turned off", () => {
    render(
      <Harness
        field={
          { ...baseField, admin: { isClearable: false } } as SelectFieldConfig
        }
        defaultValue="red"
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();
  });

  it("never offers to clear a required field, whatever Clearable says", () => {
    const { rerender } = render(
      <Harness
        field={{ ...baseField, required: true } as SelectFieldConfig}
        defaultValue="red"
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();

    rerender(
      <Harness
        field={
          {
            ...baseField,
            validation: { required: true },
            admin: { isClearable: true },
          } as SelectFieldConfig
        }
        defaultValue="red"
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();
  });

  it("renders the clear button when isClearable is true AND value is set", () => {
    render(
      <Harness
        field={
          { ...baseField, admin: { isClearable: true } } as SelectFieldConfig
        }
        defaultValue="red"
      />
    );
    expect(
      screen.getByRole("button", { name: /clear selection/i })
    ).toBeInTheDocument();
  });

  it("draws the clear button beside the trigger, where the keyboard reaches it", async () => {
    // 🔴 Drawn over the trigger, the × crowded its chevron ("⌄×") and was taken
    // out of the tab order, so only a pointer could clear the field.
    render(
      <Harness
        field={
          { ...baseField, admin: { isClearable: true } } as SelectFieldConfig
        }
        defaultValue="red"
      />
    );
    const clear = screen.getByRole("button", { name: /clear selection/i });
    expect(clear.closest('[role="combobox"]')).toBeNull();
    await userEvent.tab();
    expect(screen.getByRole("combobox")).toHaveFocus();
    await userEvent.tab();
    expect(clear).toHaveFocus();
  });

  it("hides the clear button when value is empty even with isClearable on", () => {
    render(
      <Harness
        field={
          { ...baseField, admin: { isClearable: true } } as SelectFieldConfig
        }
        defaultValue=""
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();
  });

  it("clicking the clear button empties the value", async () => {
    const user = userEvent.setup();
    function ProbedHarness() {
      const methods = useForm({ defaultValues: { color: "red" } });
      const watched = methods.watch("color");
      return (
        <FormProvider {...methods}>
          <div data-testid="value">{String(watched)}</div>
          <SelectInput
            name="color"
            field={
              {
                ...baseField,
                admin: { isClearable: true },
              } as SelectFieldConfig
            }
            control={methods.control}
          />
        </FormProvider>
      );
    }
    render(<ProbedHarness />);

    expect(screen.getByTestId("value").textContent).toBe("red");

    await user.click(screen.getByRole("button", { name: /clear selection/i }));

    expect(screen.getByTestId("value").textContent).toBe("");
  });

  it("hides the clear button when disabled / readOnly even with a value", () => {
    const { rerender } = render(
      <Harness
        field={
          { ...baseField, admin: { isClearable: true } } as SelectFieldConfig
        }
        defaultValue="red"
        disabled
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();

    rerender(
      <Harness
        field={
          { ...baseField, admin: { isClearable: true } } as SelectFieldConfig
        }
        defaultValue="red"
        readOnly
      />
    );
    expect(
      screen.queryByRole("button", { name: /clear selection/i })
    ).not.toBeInTheDocument();
  });
});

// A radio group has no "nothing" among its options, so an optional one picked
// by mistake could not be emptied again. It offers to clear by the select's
// own rule, beside the options rather than as one of them.
describe("RadioInput — clearing an optional choice", () => {
  const radioField: RadioFieldConfig = {
    type: "radio",
    name: "size",
    options: [
      { label: "Small", value: "small" },
      { label: "Large", value: "large" },
    ],
  };

  function RadioHarness({
    field,
    defaultValue,
  }: {
    field: RadioFieldConfig;
    defaultValue: string;
  }) {
    const methods = useForm({ defaultValues: { size: defaultValue } });
    const watched = methods.watch("size");
    return (
      <FormProvider {...methods}>
        <div data-testid="value">{String(watched)}</div>
        <RadioInput name="size" field={field} control={methods.control} />
      </FormProvider>
    );
  }

  it("clears an optional choice, and offers nothing once it is empty", async () => {
    const user = userEvent.setup();
    render(<RadioHarness field={radioField} defaultValue="small" />);
    expect(screen.getByRole("radio", { name: "Small" })).toBeChecked();

    await user.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByTestId("value").textContent).toBe("");
    expect(screen.getByRole("radio", { name: "Small" })).not.toBeChecked();
    expect(
      screen.queryByRole("button", { name: "Clear selection" })
    ).not.toBeInTheDocument();
  });

  it("does not offer to clear a required choice", () => {
    render(
      <RadioHarness
        field={{ ...radioField, required: true } as RadioFieldConfig}
        defaultValue="small"
      />
    );
    expect(
      screen.queryByRole("button", { name: "Clear selection" })
    ).not.toBeInTheDocument();
  });
});
