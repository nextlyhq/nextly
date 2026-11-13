// @vitest-environment jsdom
/**
 * The settings row: label and help on the left, the control on the right.
 *
 * `FieldRow` is the grid alone, and `FieldShell`'s row layout places the same
 * wiring the stacked layout computes into it. What separates a correct row
 * from a plausible broken one is WHERE each part lands — a row that drew the
 * label and the control in one column would still render every part and pass
 * any test that only looked for their presence — and that the wiring survives
 * the move: the label still targets the control, and the help and the error
 * still describe it.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldRow } from "./field-row";
import { FieldShell } from "./field-shell";

afterEach(cleanup);

/** The row's two columns, left then right. */
function columnsOf(row: Element): [Element, Element] {
  const [left, right] = Array.from(row.children);
  if (!left || !right) throw new Error("the row has fewer than two columns");
  return [left, right];
}

describe("FieldRow", () => {
  it("draws its aside in the left column and its children in the right", () => {
    const { container } = render(
      <FieldRow aside={<span>Site name</span>}>
        <input aria-label="control" />
      </FieldRow>
    );
    const row = container.querySelector('[data-slot="field-row"]')!;
    const [left, right] = columnsOf(row);

    expect(row.className).toMatch(/md:grid-cols-\[2fr_3fr\]/);
    expect(left.textContent).toContain("Site name");
    expect(right.querySelector("input")).not.toBeNull();
    expect(left.querySelector("input")).toBeNull();
  });

  it("passes its attributes to the row, so a group can name itself", () => {
    render(
      <FieldRow
        role="group"
        aria-labelledby="sep"
        aside={<span id="sep">Title separator</span>}
      >
        <button type="button">|</button>
      </FieldRow>
    );

    expect(screen.getByRole("group", { name: "Title separator" }).tagName).toBe(
      "DIV"
    );
  });

  it("supplies no vertical padding of its own", () => {
    const { container } = render(
      <FieldRow aside="x">
        <input aria-label="control" />
      </FieldRow>
    );
    const row = container.querySelector('[data-slot="field-row"]')!;

    expect(row.className).not.toMatch(/(^|\s)py-/);
  });
});

describe("FieldShell layout=row", () => {
  it("puts the label and help on the left and the control and error on the right", () => {
    const { container } = render(
      <FieldShell
        layout="row"
        label="Site name"
        description="Ends every title."
        error="Required"
      >
        <input />
      </FieldShell>
    );
    const row = container.querySelector('[data-slot="field-row"]');
    expect(row).not.toBeNull();
    const [left, right] = columnsOf(row!);

    expect(left.textContent).toContain("Site name");
    expect(left.textContent).toContain("Ends every title.");
    expect(right.querySelector("input")).not.toBeNull();
    expect(right.textContent).toContain("Required");
    expect(right.textContent).not.toContain("Ends every title.");
  });

  it("keeps the label, help and error wired to the control", () => {
    render(
      <FieldShell
        layout="row"
        label="Site name"
        description="Ends every title."
        error="Required"
      >
        <input />
      </FieldShell>
    );
    const input = screen.getByLabelText("Site name");

    expect(input.tagName).toBe("INPUT");
    const description = (input.getAttribute("aria-describedby") ?? "")
      .split(" ")
      .map(id => document.getElementById(id)?.textContent)
      .join(" ");
    expect(description).toBe("Ends every title. Required");
    expect(input.getAttribute("aria-invalid")).toBe("true");
  });

  it("lets the control fill the right column unless a width caps it", () => {
    const { container: filled } = render(
      <FieldShell layout="row" label="Filled">
        <input />
      </FieldShell>
    );
    const { container: capped } = render(
      <FieldShell layout="row" label="Capped" width="half">
        <input />
      </FieldShell>
    );

    expect(filled.querySelector("input")!.parentElement!.className).not.toMatch(
      /max-w-/
    );
    expect(capped.querySelector("input")!.parentElement!.className).toMatch(
      /max-w-\[var\(--nx-field-half/
    );
  });

  it("leaves the stacked layout as it was: one column, short by default", () => {
    const { container } = render(
      <FieldShell label="Stacked">
        <input />
      </FieldShell>
    );

    expect(container.querySelector('[data-slot="field-row"]')).toBeNull();
    expect(container.querySelector("input")!.parentElement!.className).toMatch(
      /max-w-\[var\(--nx-field-half/
    );
  });
});
