/**
 * The property under test is that each end of the range is labelled by
 * something a user can SEE, and that the label is bound to its own input.
 *
 * An `aria-label` satisfies `getByLabelText` while rendering nothing a sighted
 * user can see, and that is exactly what the markup this replaced carried:
 * `aria-label="Condition value from"` plus a `placeholder` that a date input
 * ignores. A query on the accessible name therefore passes on both the fixed
 * and the broken version, so it is not the separating property.
 *
 * What separates them is a `<label>` ELEMENT whose `for` resolves to the input:
 * rendered text, bound to a control. Hence `labelFor` below rather than a
 * name-based assertion alone.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { RangeField } from "./index";

function labelFor(input: HTMLElement): HTMLLabelElement | null {
  return input.ownerDocument.querySelector<HTMLLabelElement>(
    `label[for="${input.id}"]`
  );
}

describe("RangeField", () => {
  it("labels each end with visible text bound to that input", () => {
    render(
      <RangeField
        label="Created date"
        type="date"
        from=""
        to=""
        onFromChange={() => {}}
        onToChange={() => {}}
      />
    );

    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");

    // The name has to come from a real label element, not a placeholder: a date
    // input ignores `placeholder` entirely, so a placeholder-named field is
    // invisible in exactly the case this component exists for.
    expect(labelFor(from)?.textContent).toBe("From");
    expect(labelFor(to)?.textContent).toBe("To");
    expect(from.getAttribute("placeholder")).toBeNull();
    expect(to.getAttribute("placeholder")).toBeNull();

    // Distinct ids, so each label points at its own control rather than both
    // resolving to the first.
    expect(from.id).not.toBe(to.id);
  });

  it("gives two instances different ids", () => {
    // Two ranges on one page is the normal case (created and updated), and
    // hand-built ids collide there, which silently points one range's labels at
    // the other's inputs.
    render(
      <>
        <RangeField
          label="Created date"
          from=""
          to=""
          onFromChange={() => {}}
          onToChange={() => {}}
          fromLabel="Created after"
          toLabel="Created before"
        />
        <RangeField
          label="Updated date"
          from=""
          to=""
          onFromChange={() => {}}
          onToChange={() => {}}
          fromLabel="Updated after"
          toLabel="Updated before"
        />
      </>
    );

    const ids = [
      screen.getByLabelText("Created after").id,
      screen.getByLabelText("Created before").id,
      screen.getByLabelText("Updated after").id,
      screen.getByLabelText("Updated before").id,
    ];
    expect(new Set(ids).size).toBe(4);
  });

  it("names the pair as a group", () => {
    render(
      <RangeField
        label="Created date"
        from=""
        to=""
        onFromChange={() => {}}
        onToChange={() => {}}
      />
    );
    expect(screen.getByRole("group", { name: "Created date" })).toBeTruthy();
  });

  it("reports each end separately", () => {
    const onFromChange = vi.fn();
    const onToChange = vi.fn();
    render(
      <RangeField
        label="Created date"
        from="2026-01-01"
        to="2026-02-01"
        onFromChange={onFromChange}
        onToChange={onToChange}
      />
    );

    // Values land on the right control. Swapping them is the kind of mistake a
    // labelled-but-unasserted component makes look correct.
    expect((screen.getByLabelText("From") as HTMLInputElement).value).toBe(
      "2026-01-01"
    );
    expect((screen.getByLabelText("To") as HTMLInputElement).value).toBe(
      "2026-02-01"
    );
  });
});
