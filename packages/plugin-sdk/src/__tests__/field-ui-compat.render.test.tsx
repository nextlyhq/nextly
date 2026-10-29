// @vitest-environment jsdom
/**
 * Runtime half of the field-UI contract: renders each field-UI export with
 * today's props, loaded from the package's BUILT `@nextlyhq/plugin-sdk/admin`
 * entry, the module a plugin's bundle imports. The type half,
 * `../field-ui-compat.test-d.ts`, pins the props; this pins that each part is
 * still there at runtime, still a working component or function, and still
 * draws what it is given. A name exported as a type only, or a re-export that
 * resolves to `undefined` in the bundle, type-checks and fails only here.
 *
 * The props below are written as a plugin wrote them, the Form Builder's way:
 * plain literals, nothing derived from the admin's types. Each part is
 * rendered outside any admin provider, as a plugin's own tests render it.
 *
 * This stays until the release that removes these parts.
 */
import * as adminEntry from "@nextlyhq/plugin-sdk/admin";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

declare global {
  // React reads this to know `act` drives the renders, so it warns otherwise.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

const {
  ConditionRow,
  drawsAnyValidationRule,
  EDITABLE_VALIDATION_RULES,
  FieldDefaultValueInput,
  FieldOptionsEditor,
  FieldTypePicker,
  operatorsForType,
  operatorTakesValue,
  usePluginFieldTypeEntries,
  ValidationNumberField,
  ValidationRulesEditor,
  withOptionIds,
} = adminEntry;

/** The field-UI value exports today, the same set the type test names. */
const TODAY_FIELD_UI_EXPORTS = [
  "FieldTypePicker",
  "FieldDefaultValueInput",
  "FieldOptionsEditor",
  "withOptionIds",
  "usePluginFieldTypeEntries",
  "ConditionRow",
  "operatorsForType",
  "operatorTakesValue",
  "ValidationNumberField",
  "ValidationRulesEditor",
  "drawsAnyValidationRule",
  "EDITABLE_VALIDATION_RULES",
] as const;

type FieldUiExport = (typeof TODAY_FIELD_UI_EXPORTS)[number];

let host: HTMLDivElement;
let root: Root;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  // A part that renders but logs a React error (a bad prop, a missing key, a
  // hook misused) is broken for the plugin that sees it in its console.
  consoleError = vi.spyOn(console, "error");
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  consoleError.mockRestore();
});

function render(element: ReactElement): HTMLDivElement {
  act(() => root.render(element));
  return host;
}

function inputValues(container: HTMLElement): string[] {
  return [...container.querySelectorAll("input")].map(input => input.value);
}

const noop = (): void => {};

/**
 * One case per export. `satisfies` makes a missing export a type error, and
 * the test below makes an extra or missing case a failure at runtime too.
 */
const CASES = {
  FieldTypePicker: () => {
    // A surface's built-in types, the admin's way.
    const byTypes = render(
      <FieldTypePicker
        types={["text", "number"]}
        value="text"
        onChange={noop}
        columns={2}
        ariaLabel="Field type"
      />
    );
    const cards = [...byTypes.querySelectorAll('[role="radio"]')];
    expect(cards.map(card => card.getAttribute("data-type"))).toEqual([
      "text",
      "number",
    ]);
    expect(cards.map(card => card.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);

    // A surface's own catalog rows, the Form Builder's way.
    const byEntries = render(
      <FieldTypePicker
        entries={[
          {
            type: "rating",
            label: "Star rating",
            category: "Advanced",
            hint: "One to five stars",
            icon: "Star",
          },
        ]}
        value="rating"
        onChange={noop}
        disabled
        columns={3}
      />
    );
    expect(byEntries.textContent).toContain("Star rating");
    expect(byEntries.textContent).toContain("One to five stars");
  },

  FieldDefaultValueInput: () => {
    const container = render(
      <FieldDefaultValueInput
        fieldType="text"
        value="Untitled"
        onChange={noop}
        ariaLabel="Default value"
      />
    );
    const input = container.querySelector('input[aria-label="Default value"]');
    expect(input).toBeInstanceOf(HTMLInputElement);
    expect((input as HTMLInputElement).value).toBe("Untitled");
  },

  FieldOptionsEditor: () => {
    const container = render(
      <FieldOptionsEditor
        options={[
          { id: "o1", label: "Red", value: "red" },
          { id: "o2", label: "Blue", value: "blue" },
        ]}
        onOptionsChange={noop}
        allowImport={false}
        idPrefix="colour"
      />
    );
    expect(inputValues(container)).toEqual(["Red", "red", "Blue", "blue"]);
  },

  withOptionIds: () => {
    expect(withOptionIds([{ label: "Small", value: "s" }], "size")).toEqual([
      { id: "size_seed_0", label: "Small", value: "s" },
    ]);
    expect(withOptionIds([{ label: "Small", value: "s" }])[0].id).toBe(
      "opt_seed_0"
    );
  },

  usePluginFieldTypeEntries: () => {
    let entries: unknown;
    function Probe(): null {
      entries = usePluginFieldTypeEntries("forms");
      return null;
    }
    render(<Probe />);
    // Outside the admin no plugin contributes a type, so none is offered.
    expect(entries).toEqual([]);
  },

  ConditionRow: () => {
    const container = render(
      <ConditionRow
        condition={{ field: "status", operator: "equals", value: "draft" }}
        sources={[
          {
            name: "status",
            label: "Status",
            type: "select",
            options: [{ value: "draft", label: "Draft" }],
          },
        ]}
        onChange={noop}
        className="grid"
      />
    );
    expect(container.textContent).toContain("Status");
    expect(container.textContent).toContain("equals");
  },

  operatorsForType: () => {
    expect(operatorsForType("checkbox")).toEqual(["isTrue", "isNotTrue"]);
    expect(operatorsForType("number")).toContain("between");
    expect(operatorsForType(undefined)).toEqual(["equals", "notEquals"]);
  },

  operatorTakesValue: () => {
    expect(operatorTakesValue("equals")).toBe(true);
    expect(operatorTakesValue("isEmpty")).toBe(false);
  },

  ValidationNumberField: () => {
    const container = render(
      <ValidationNumberField
        label="Min length"
        value={3}
        onChange={noop}
        description="Fewest characters allowed."
        counts
        placeholder="None"
      />
    );
    expect(container.textContent).toContain("Min length");
    expect(container.textContent).toContain("Fewest characters allowed.");
    expect(inputValues(container)).toEqual(["3"]);
  },

  ValidationRulesEditor: () => {
    const container = render(
      <ValidationRulesEditor
        allowed={["required", "minLength", "pattern"]}
        messageDescribes="pattern"
        value={{ minLength: 2, pattern: "^[a-z]+$" }}
        onChange={noop}
      />
    );
    expect(container.textContent).toContain("Pattern");
    expect(inputValues(container)).toEqual(["2", "^[a-z]+$"]);
  },

  drawsAnyValidationRule: () => {
    expect(drawsAnyValidationRule(["required"])).toBe(false);
    expect(drawsAnyValidationRule(["required", "pattern"])).toBe(true);
  },

  EDITABLE_VALIDATION_RULES: () => {
    expect([...EDITABLE_VALIDATION_RULES].sort()).toEqual(
      [
        "max",
        "maxLength",
        "maxRows",
        "message",
        "min",
        "minLength",
        "minRows",
        "pattern",
      ].sort()
    );
  },
} satisfies Record<FieldUiExport, () => void>;

describe("renders each field-UI export with today's props", () => {
  it("covers exactly today's field-UI exports, each defined in the entry", () => {
    expect(Object.keys(CASES).sort()).toEqual(
      [...TODAY_FIELD_UI_EXPORTS].sort()
    );
    for (const name of TODAY_FIELD_UI_EXPORTS) {
      expect(adminEntry[name], name).toBeDefined();
    }
  });

  it.each(TODAY_FIELD_UI_EXPORTS)("%s", name => {
    CASES[name]();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
