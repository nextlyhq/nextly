/**
 * A control's `aria-describedby` must name an element that exists.
 *
 * This is the failure that scoping field ids can introduce and that nothing
 * else would notice: the description node and the reference to it are written
 * in two places, so moving one silently leaves the other pointing at nothing.
 * A dangling description reaches assistive technology as no description at
 * all — strictly worse than the plain error it was meant to announce, because
 * the visible text is there and the announcement is not.
 *
 * Asserted by RESOLVING the reference rather than by comparing it to an
 * expected string: a test that hard-codes the id passes just as happily when
 * both sides move together to something wrong.
 */
import userEvent from "@testing-library/user-event";
import type { JSONFieldConfig } from "nextly/config";
import { useForm } from "react-hook-form";
import { describe, it, expect } from "vitest";

import { render, screen } from "@admin/__tests__/utils";

import { FieldIdScopeContext } from "../../field-id-scope";
import { JsonInput } from "../JsonInput";

const FIELD = {
  name: "payload",
  type: "json",
  label: "Payload",
} as JSONFieldConfig;

function Harness({ scope }: { scope: string }) {
  const form = useForm<{ payload: unknown }>({
    defaultValues: { payload: {} },
  });
  return (
    <FieldIdScopeContext.Provider value={scope}>
      <JsonInput name="payload" field={FIELD} control={form.control} />
    </FieldIdScopeContext.Provider>
  );
}

/** The element a control's description points at, or null when it dangles. */
function describedNode(control: Element): Element | null {
  const id = control.getAttribute("aria-describedby");
  return id ? document.getElementById(id) : null;
}

describe("JsonInput — the parse error is reachable from the control", () => {
  it("points at a node that exists, in a scoped rendering", async () => {
    // A scoped rendering is where the two ids can diverge: the description node
    // takes the scope and a hard-coded reference does not.
    render(<Harness scope="history-1" />);

    // Queried by role alone: the visible label is supplied by `FieldWrapper`,
    // which is not part of this unit — and the property under test is the
    // description reference, not the labelling.
    const control = await screen.findByRole("textbox");
    // The parse error is a state the editor types into, not one a stored value
    // arrives in — an invalid default never round-trips through the parser.
    await userEvent.clear(control);
    await userEvent.type(control, "{{ not json");

    // POPULATION BEFORE VERDICT: a control with no description at all would
    // satisfy "the reference does not dangle" vacuously.
    expect(
      control.getAttribute("aria-describedby"),
      "a parse error must be announced at all"
    ).toBeTruthy();
    expect(
      describedNode(control),
      "the description must name an element that exists"
    ).not.toBeNull();
  });

  it("points at a node that exists in an unscoped rendering too", async () => {
    render(<Harness scope="" />);

    const control = await screen.findByRole("textbox");
    await userEvent.clear(control);
    await userEvent.type(control, "{{ not json");
    expect(control.getAttribute("aria-describedby")).toBeTruthy();
    expect(describedNode(control)).not.toBeNull();
  });
});
