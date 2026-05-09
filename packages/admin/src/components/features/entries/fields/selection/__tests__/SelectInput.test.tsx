/**
 * SelectInput.isClearable wiring test.
 *
 * Pins the contract that:
 *  - When `admin.isClearable !== true`, no clear button renders.
 *  - When `admin.isClearable === true` and the field has a value, a clear
 *    button renders next to the trigger and clicking it resets the value.
 *  - When the value is empty (or null/undefined), the clear button stays
 *    hidden — there's nothing to clear.
 *  - disabled / readOnly suppress the button so it can't be clicked.
 *
 * Regression coverage for the wiring gap where `isClearable` lived on the
 */
import type { SelectFieldConfig } from "nextly/config";
import userEvent from "@testing-library/user-event";
import type React from "react";
import { useForm, FormProvider } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

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
  it("does NOT render the clear button by default", () => {
    render(<Harness field={baseField} defaultValue="red" />);
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
