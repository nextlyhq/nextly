import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  ConditionRow,
  operatorTakesValue,
  operatorsForType,
  type ConditionSource,
} from "./ConditionRow";

const SOURCES: ConditionSource[] = [
  { name: "title", label: "Title", type: "text" },
  { name: "count", label: "Count", type: "number" },
  { name: "agreed", label: "Agreed", type: "checkbox" },
  { name: "due", label: "Due", type: "date" },
  { name: "odd", label: "Odd", type: "some-plugin-type" },
];

describe("which operators a type offers", () => {
  it("offers comparisons a type can actually answer", () => {
    // The point of type-awareness: a checkbox has no "is greater than", and
    // offering one produces a condition that can never be true.
    expect(operatorsForType("checkbox")).toEqual(["isTrue", "isNotTrue"]);
    expect(operatorsForType("text")).toContain("startsWith");
    expect(operatorsForType("text")).not.toContain("greaterThan");
    expect(operatorsForType("number")).toContain("greaterThan");
    expect(operatorsForType("number")).not.toContain("startsWith");
    expect(operatorsForType("date")).toContain("before");
  });

  it("gives an unknown type equality rather than nothing", () => {
    // A surface with its own field types should keep a usable row, not lose it.
    // Every type supports equality, so that is the honest floor.
    expect(operatorsForType("some-plugin-type")).toEqual([
      "equals",
      "notEquals",
    ]);
    expect(operatorsForType(undefined)).toEqual(["equals", "notEquals"]);
  });

  it("knows which operators compare against nothing", () => {
    for (const op of [
      "isEmpty",
      "isNotEmpty",
      "isTrue",
      "isNotTrue",
    ] as const) {
      expect(operatorTakesValue(op)).toBe(false);
    }
    expect(operatorTakesValue("equals")).toBe(true);
    expect(operatorTakesValue("between")).toBe(true);
  });
});

describe("editing one condition", () => {
  it("emits the edited condition, keeping field and operator", async () => {
    // Driven through the value input rather than the two Selects: those are
    // Radix portals, which jsdom cannot open without a pointer-capture shim
    // this package does not install. The emit path is the same either way, and
    // it is the contract worth pinning — the Select's own behaviour is not.
    const onChange = vi.fn();
    render(
      <ConditionRow
        condition={{ field: "title", operator: "contains" }}
        sources={SOURCES}
        onChange={onChange}
      />
    );
    await userEvent.type(screen.getByLabelText("Condition value"), "a");
    expect(onChange).toHaveBeenCalledWith({
      field: "title",
      operator: "contains",
      value: "a",
    });
  });

  it("will not let a value be typed before a source is chosen", () => {
    // Named for what it asserts. A row with no field is not a condition yet, so
    // the value editor stays inert rather than collecting input that has
    // nowhere to go.
    render(
      <ConditionRow
        condition={undefined}
        sources={SOURCES}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Condition value")).toBeDisabled();
    expect(screen.getByLabelText("Condition operator")).toBeDisabled();
  });

  it("hides the value editor for an operator that takes none", () => {
    render(
      <ConditionRow
        condition={{ field: "agreed", operator: "isTrue" }}
        sources={SOURCES}
        onChange={vi.fn()}
      />
    );
    expect(screen.queryByLabelText("Condition value")).toBeNull();
  });

  it("shows two labelled inputs for a range", () => {
    render(
      <ConditionRow
        condition={{ field: "count", operator: "between", value: { min: 1 } }}
        sources={SOURCES}
        onChange={vi.fn()}
      />
    );

    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    expect(from).toHaveValue(1);
    expect(to).toHaveValue(null);

    // Bound by a real label rather than named by an `aria-label`. The pair used
    // to be distinguished only by an accessible name and a placeholder, and a
    // date input renders neither -- so both ends drew as the same empty
    // `dd/mm/yyyy` box with nothing saying which was which.
    const document = from.ownerDocument;
    expect(document.querySelector(`label[for="${from.id}"]`)?.textContent).toBe(
      "From"
    );
    expect(document.querySelector(`label[for="${to.id}"]`)?.textContent).toBe(
      "To"
    );

    // The short labels are disambiguated by the group they sit in, which is
    // what a screen reader announces on entry.
    expect(
      screen.getByRole("group", { name: "Condition value range" })
    ).toBeTruthy();
  });

  it("labels a date range the same way, where a placeholder would not render", () => {
    // The regression this guards is type-specific and therefore invisible in
    // the markup: `placeholder="From"` renders on text and number inputs and is
    // ignored outright on a date input. Asserting the number case alone would
    // have stayed green through the whole defect.
    render(
      <ConditionRow
        condition={{ field: "due", operator: "between", value: {} }}
        sources={SOURCES}
        onChange={vi.fn()}
      />
    );

    const from = screen.getByLabelText("From");
    expect(from.getAttribute("type")).toBe("date");
    expect(from.getAttribute("placeholder")).toBeNull();
    expect(
      from.ownerDocument.querySelector(`label[for="${from.id}"]`)?.textContent
    ).toBe("From");
  });

  it("falls back when the source no longer offers the stored operator", () => {
    // Switching a source from text to number leaves `startsWith` behind. A
    // Select with no matching item renders blank, so the row would show an
    // operator the author cannot see and cannot change.
    render(
      <ConditionRow
        condition={{ field: "count", operator: "startsWith", value: "x" }}
        sources={SOURCES}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Condition operator")).toHaveTextContent(
      "equals"
    );
  });

  it("lets a surface narrow the operator set", () => {
    // The form builder offers fewer than the schema builder does, so the policy
    // has to be the caller's to override rather than baked in.
    render(
      <ConditionRow
        condition={{ field: "title", operator: "equals" }}
        sources={SOURCES}
        operatorsFor={() => ["equals"]}
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Condition operator")).toHaveTextContent(
      "equals"
    );
  });

  it("disables every control when read-only", () => {
    render(
      <ConditionRow
        condition={{ field: "title", operator: "equals", value: "a" }}
        sources={SOURCES}
        readOnly
        onChange={vi.fn()}
      />
    );
    expect(screen.getByLabelText("Condition value")).toBeDisabled();
  });
});
