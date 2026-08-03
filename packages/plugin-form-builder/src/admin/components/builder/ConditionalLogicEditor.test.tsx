// @vitest-environment jsdom

/**
 * What this pins is the boundary between the shared condition row and this
 * plugin's stored shape. The row speaks `operator`; a form stores `comparison`,
 * from a vocabulary of seven that `evaluateConditions` implements. A condition
 * written in any other vocabulary saves without complaint and then never
 * matches at form time, so the mapping is the part worth testing rather than
 * the row's own behaviour, which the kit tests own.
 *
 * jsdom is requested per file rather than in the shared vitest config: the
 * integration suites in this package boot a real Nextly instance and have no
 * use for a DOM.
 */
import "@testing-library/jest-dom/vitest";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AnyFormField } from "../../../types";
import { ConditionalLogicEditor } from "./ConditionalLogicEditor";

// jsdom implements neither pointer capture nor scrollIntoView, and Radix calls
// both when a Select opens; without them a test dies on a missing method
// rather than failing an assertion.
beforeAll(() => {
  Element.prototype.hasPointerCapture = () => false;
  Element.prototype.setPointerCapture = () => undefined;
  Element.prototype.releasePointerCapture = () => undefined;
  Element.prototype.scrollIntoView = () => undefined;
});

afterEach(cleanup);

const country = {
  id: "f1",
  name: "country",
  label: "Country",
  type: "select",
  options: [
    { label: "United States", value: "us" },
    { label: "Canada", value: "ca" },
  ],
} as unknown as AnyFormField;

const age = {
  id: "f2",
  name: "age",
  label: "Age",
  type: "number",
} as unknown as AnyFormField;

// A checkbox is the source type where the kit's default and this plugin's
// vocabulary genuinely disagree: the kit offers isTrue/isNotTrue, and
// `evaluateConditions` implements neither.
const subscribed = {
  id: "f4",
  name: "subscribed",
  label: "Subscribed",
  type: "checkbox",
} as unknown as AnyFormField;

const subjectOnCheckbox = {
  id: "f5",
  name: "subject",
  label: "Subject",
  type: "text",
  conditionalLogic: {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field: "subscribed", comparison: "equals", value: "" }],
  },
} as unknown as AnyFormField;

const subject = {
  id: "f3",
  name: "subject",
  label: "Subject",
  type: "text",
  conditionalLogic: {
    enabled: true,
    action: "show",
    operator: "AND",
    conditions: [{ field: "country", comparison: "equals", value: "us" }],
  },
} as unknown as AnyFormField;

function renderEditor(onUpdate: ReturnType<typeof vi.fn>, field = subject) {
  render(
    <ConditionalLogicEditor
      field={field}
      allFields={[country, age, subscribed, field]}
      onUpdate={onUpdate}
    />
  );
}

describe("ConditionalLogicEditor storage contract", () => {
  it("writes back the comparison key, not the row's operator key", async () => {
    // The row reports `operator`; storage and `evaluateConditions` read
    // `comparison`. Writing the row's key straight through would save a
    // condition the evaluator cannot see.
    const onUpdate = vi.fn();
    renderEditor(onUpdate);

    await userEvent.click(
      screen.getByRole("combobox", { name: /condition operator/i })
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "does not equal" })
    );

    expect(onUpdate).toHaveBeenCalledTimes(1);
    const written = onUpdate.mock.calls[0]?.[0]?.conditionalLogic
      ?.conditions?.[0] as Record<string, unknown>;
    expect(written).toMatchObject({
      field: "country",
      comparison: "notEquals",
    });
    expect(written).not.toHaveProperty("operator");
  });

  it("offers only comparisons this plugin's evaluator implements", async () => {
    // Driven off a CHECKBOX source, because that is where the kit's default
    // and this plugin's vocabulary actually differ: the kit offers
    // isTrue/isNotTrue there and `evaluateConditions` implements neither, so a
    // condition built from them saves, renders, and never matches. Pointed at
    // a select instead, this test passed with the narrowing removed — the
    // kit's own select operators are already a subset.
    renderEditor(vi.fn(), subjectOnCheckbox);

    await userEvent.click(
      screen.getByRole("combobox", { name: /condition operator/i })
    );
    const offered = (await screen.findAllByRole("option")).map(o =>
      o.textContent?.trim()
    );

    expect(offered).toEqual(["equals", "does not equal"]);
  });

  it("compares a choice field against its own options", async () => {
    // Typing an option value by hand is how a condition ends up referring to a
    // choice that does not exist, with nothing on screen to say so.
    const onUpdate = vi.fn();
    renderEditor(onUpdate);

    await userEvent.click(
      screen.getByRole("combobox", { name: /condition value/i })
    );
    await userEvent.click(
      await screen.findByRole("option", { name: "Canada" })
    );

    expect(
      onUpdate.mock.calls[0]?.[0]?.conditionalLogic?.conditions?.[0]
    ).toMatchObject({ field: "country", value: "ca" });
  });

  it("keeps the enable toggle and joiner this surface owns", () => {
    // The kit owns the row and not the container; these controls have no
    // equivalent in the schema builder and must survive the port.
    renderEditor(vi.fn());
    expect(screen.getByRole("checkbox")).toBeChecked();
    expect(
      screen.getByText(/of the following conditions are met/i)
    ).toBeVisible();
    expect(
      screen.getByRole("button", { name: /add condition/i })
    ).toBeInTheDocument();
  });
});
