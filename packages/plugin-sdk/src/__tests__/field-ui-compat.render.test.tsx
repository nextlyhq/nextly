// @vitest-environment jsdom
/**
 * Runtime half of the field-UI contract: renders each field-UI export with
 * today's props, loaded from the package's BUILT `@nextlyhq/plugin-sdk/admin`
 * entry, the module a plugin's bundle imports. The type half,
 * `../field-ui-compat.test-d.ts`, pins the props; this pins that each part is
 * still there at runtime, still a working component or function, and still
 * acts on the props it is given. A name exported as a type only, or a
 * re-export that resolves to `undefined` in the bundle, type-checks and fails
 * only here.
 *
 * The props below are written as a plugin wrote them, the Form Builder's way:
 * plain literals, nothing derived from the admin's types. Each part is
 * rendered outside any admin provider, as a plugin's own tests render it.
 *
 * The built entry is there because `turbo.json` makes this package's tests
 * depend on its own build; `vitest.global-setup.ts` stops a run that bypasses
 * that edge before it reaches a missing entry.
 *
 * This stays until the release that removes these parts.
 */
import * as entry from "@nextlyhq/plugin-sdk/admin";
import { act, type ReactElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { TodayFieldUiExport } from "../field-ui-compat.test-d";

declare global {
  // React reads this to know `act` drives the renders, so it warns otherwise.
  var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}

/** The field-UI value exports today, held to the type test's set below. */
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
] as const satisfies readonly TodayFieldUiExport[];

let host: HTMLDivElement;
let root: Root;
let mounted: boolean;
let consoleError: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  globalThis.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  mounted = true;
  // A part that renders but logs a React error (a bad prop, a missing key, a
  // hook misused) is broken for the plugin that sees it in its console.
  consoleError = vi.spyOn(console, "error");
});

/** Unmounts the part, so what it logs on teardown is asserted too. */
function unmount(): void {
  if (!mounted) return;
  act(() => root.unmount());
  mounted = false;
}

afterEach(() => {
  unmount();
  host.remove();
  consoleError.mockRestore();
});

function render(element: ReactElement): HTMLDivElement {
  act(() => root.render(element));
  return host;
}

function inputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll("input")];
}

function buttonLabelled(
  container: HTMLElement,
  text: string
): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    button => button.textContent?.trim() === text
  );
}

const noop = (): void => {};

/**
 * One case per export. `satisfies` makes a missing or extra case a type
 * error, and the first test below makes it a failure at runtime too.
 */
const CASES = {
  FieldTypePicker: () => {
    const { FieldTypePicker } = entry;
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
    const group = byTypes.querySelector('[role="radiogroup"]');
    expect(group?.getAttribute("aria-label")).toBe("Field type");
    const twoColumns = group?.className;
    const cards = [
      ...byTypes.querySelectorAll<HTMLButtonElement>('[role="radio"]'),
    ];
    expect(cards.map(card => card.getAttribute("data-type"))).toEqual([
      "text",
      "number",
    ]);
    expect(cards.map(card => card.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
    ]);
    expect(cards.map(card => card.disabled)).toEqual([false, false]);

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
    expect(
      byEntries.querySelector<HTMLButtonElement>('[role="radio"]')?.disabled
    ).toBe(true);
    expect(byEntries.querySelector('[role="radiogroup"]')?.className).not.toBe(
      twoColumns
    );

    // Every optional prop left out, as most plugins write it: today's defaults
    // are two columns, the accessible name "Field type", and cards enabled.
    const byDefaults = render(
      <FieldTypePicker types={["text"]} value="text" onChange={noop} />
    );
    const defaultGroup = byDefaults.querySelector('[role="radiogroup"]');
    expect(defaultGroup?.getAttribute("aria-label")).toBe("Field type");
    expect(defaultGroup?.className).toBe(twoColumns);
    expect(
      byDefaults.querySelector<HTMLButtonElement>('[role="radio"]')?.disabled
    ).toBe(false);
  },

  FieldDefaultValueInput: () => {
    const { FieldDefaultValueInput } = entry;
    const container = render(
      <FieldDefaultValueInput
        fieldType="text"
        value="Untitled"
        onChange={noop}
        disabled
        ariaLabel="Default value"
      />
    );
    const input = container.querySelector<HTMLInputElement>(
      'input[aria-label="Default value"]'
    );
    expect(input?.value).toBe("Untitled");
    expect(input?.disabled).toBe(true);

    // Optional props left out: named "Default value" and enabled, by default.
    const byDefaults = render(
      <FieldDefaultValueInput fieldType="text" value="" onChange={noop} />
    );
    const defaultInput = byDefaults.querySelector<HTMLInputElement>(
      'input[aria-label="Default value"]'
    );
    expect(defaultInput?.disabled).toBe(false);
  },

  FieldOptionsEditor: () => {
    const { FieldOptionsEditor } = entry;
    const options = [
      { id: "o1", label: "Red", value: "red" },
      { id: "o2", label: "Blue", value: "blue" },
    ];
    const withoutImport = render(
      <FieldOptionsEditor
        options={options}
        onOptionsChange={noop}
        allowImport={false}
        idPrefix="colour"
      />
    );
    expect(inputs(withoutImport).map(input => input.value)).toEqual([
      "Red",
      "red",
      "Blue",
      "blue",
    ]);
    expect(buttonLabelled(withoutImport, "Import")).toBeUndefined();

    // The same list with the import offered, so the absence above is the
    // prop's doing and not a label that changed.
    const withImport = render(
      <FieldOptionsEditor options={options} onOptionsChange={noop} disabled />
    );
    expect(buttonLabelled(withImport, "Import")?.disabled).toBe(true);

    // Optional props left out: the import is offered and enabled, by default.
    const byDefaults = render(
      <FieldOptionsEditor options={options} onOptionsChange={noop} />
    );
    expect(buttonLabelled(byDefaults, "Import")?.disabled).toBe(false);
  },

  withOptionIds: () => {
    const { withOptionIds } = entry;
    expect(withOptionIds([{ label: "Small", value: "s" }], "size")).toEqual([
      { id: "size_seed_0", label: "Small", value: "s" },
    ]);
    expect(withOptionIds([{ label: "Small", value: "s" }])[0].id).toBe(
      "opt_seed_0"
    );
  },

  usePluginFieldTypeEntries: () => {
    const { usePluginFieldTypeEntries } = entry;
    let entries: unknown;
    function Probe(): null {
      entries = usePluginFieldTypeEntries("forms");
      return null;
    }
    render(<Probe />);
    // Outside the admin's providers no plugin is installed, so none of their
    // types is offered. This pins the hook's call shape and its answer; that
    // installed plugins' types reach the list is the projection's job, tested
    // in `packages/admin/src/lib/builder/plugin-field-type-entries.test.ts`.
    expect(entries).toEqual([]);
  },

  ConditionRow: () => {
    const { ConditionRow } = entry;
    const condition = {
      field: "status",
      operator: "equals",
      value: "draft",
    } as const;
    const sources = [
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [{ value: "draft", label: "Draft" }],
      },
    ];
    const controls = (container: HTMLElement): HTMLButtonElement[] => [
      ...container.querySelectorAll<HTMLButtonElement>('[role="combobox"]'),
    ];

    // Optional props left out: every control is enabled, by default.
    const byDefaults = render(
      <ConditionRow condition={condition} sources={sources} onChange={noop} />
    );
    expect(byDefaults.textContent).toContain("Status");
    expect(byDefaults.textContent).toContain("equals");
    expect(controls(byDefaults).length).toBeGreaterThan(0);
    expect(controls(byDefaults).every(control => !control.disabled)).toBe(true);

    const container = render(
      <ConditionRow
        condition={condition}
        sources={sources}
        onChange={noop}
        readOnly
        className="condition-row-layout"
      />
    );
    expect(container.querySelector(".condition-row-layout")).not.toBeNull();
    expect(controls(container).every(control => control.disabled)).toBe(true);
  },

  operatorsForType: () => {
    const { operatorsForType } = entry;
    expect(operatorsForType("checkbox")).toEqual(["isTrue", "isNotTrue"]);
    expect(operatorsForType("number")).toContain("between");
    expect(operatorsForType(undefined)).toEqual(["equals", "notEquals"]);
  },

  operatorTakesValue: () => {
    const { operatorTakesValue } = entry;
    expect(operatorTakesValue("equals")).toBe(true);
    expect(operatorTakesValue("isEmpty")).toBe(false);
  },

  ValidationNumberField: () => {
    const { ValidationNumberField } = entry;
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
    const [input] = inputs(container);
    expect(input.value).toBe("3");
    expect(input.placeholder).toBe("None");
    // `counts`: a bound that counts things takes whole numbers from zero.
    expect([input.min, input.step]).toEqual(["0", "1"]);

    // `counts` left out: a bound on a value, which may be fractional or
    // negative, so neither limit is set.
    const byDefaults = render(
      <ValidationNumberField label="Min" value={undefined} onChange={noop} />
    );
    const [defaultInput] = inputs(byDefaults);
    expect([defaultInput.min, defaultInput.step]).toEqual(["", ""]);
  },

  ValidationRulesEditor: () => {
    const { ValidationRulesEditor } = entry;
    const container = render(
      <ValidationRulesEditor
        allowed={["required", "minLength", "pattern", "message"]}
        messageDescribes="pattern"
        value={{ minLength: 2, pattern: "^[a-z]+$" }}
        onChange={noop}
        disabled
      />
    );
    expect(container.textContent).toContain("Pattern");
    expect(container.textContent).toContain("fails the Pattern above");
    expect(inputs(container).map(input => input.value)).toEqual([
      "2",
      "^[a-z]+$",
      "",
    ]);
    expect(inputs(container).every(input => input.disabled)).toBe(true);

    // Optional props left out: the message says it is shown for any failed
    // rule, and every control is enabled, by default.
    const byDefaults = render(
      <ValidationRulesEditor
        allowed={["minLength", "message"]}
        value={{}}
        onChange={noop}
      />
    );
    expect(byDefaults.textContent).toContain("fails validation");
    expect(byDefaults.textContent).not.toContain("fails the Pattern above");
    expect(inputs(byDefaults).every(input => !input.disabled)).toBe(true);
  },

  drawsAnyValidationRule: () => {
    const { drawsAnyValidationRule } = entry;
    expect(drawsAnyValidationRule(["required"])).toBe(false);
    expect(drawsAnyValidationRule(["required", "pattern"])).toBe(true);
  },

  EDITABLE_VALIDATION_RULES: () => {
    const { EDITABLE_VALIDATION_RULES } = entry;
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
} satisfies Record<TodayFieldUiExport, () => void>;

describe("renders each field-UI export with today's props", () => {
  it("covers exactly today's field-UI exports, each defined in the entry", () => {
    expect(Object.keys(CASES).sort()).toEqual(
      [...TODAY_FIELD_UI_EXPORTS].sort()
    );
    for (const name of TODAY_FIELD_UI_EXPORTS) {
      expect(entry[name], name).toBeDefined();
    }
  });

  it.each(TODAY_FIELD_UI_EXPORTS)("%s", name => {
    CASES[name]();
    unmount();
    expect(consoleError).not.toHaveBeenCalled();
  });
});
