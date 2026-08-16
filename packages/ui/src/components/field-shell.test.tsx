// @vitest-environment jsdom
/**
 * A field's width is a NAME, not a measurement, and each name caps the control
 * rather than the row. The row still spans its container so the label and the
 * error message align with everything above and below them; only the control
 * is constrained. Asserting the cap on the row instead would pass while
 * producing ragged labels.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { FieldShell } from "./field-shell";

// Several cases below share the label text "Name" and query for it through
// the shared jsdom document via `screen`, so a leftover mount from an earlier
// case would make a later `getByLabelText`/`getByText` see more than one
// match. Unmounting after every test keeps each case reading only its own DOM.
afterEach(cleanup);

describe("FieldShell", () => {
  it("caps a half-width control at the half token", () => {
    const { container } = render(
      <FieldShell label="Name" width="half">
        <input aria-label="Name" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-half");
  });

  it("caps a full-width control at the full token", () => {
    const { container } = render(
      <FieldShell label="Description" width="full">
        <input aria-label="Description" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-full");
  });

  it("leaves a fill control uncapped", () => {
    const { container } = render(
      <FieldShell label="Body" width="fill">
        <input aria-label="Body" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).not.toContain("max-w-");
  });

  it("defaults to half when no width is given", () => {
    const { container } = render(
      <FieldShell label="Slug">
        <input aria-label="Slug" />
      </FieldShell>
    );
    const control = container.querySelector("input")?.parentElement;
    expect(control?.className).toContain("--nx-field-half");
  });

  it("renders a description only when one is supplied", () => {
    const { rerender } = render(
      <FieldShell label="Name" description="Shown in the key list.">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.getByText("Shown in the key list.")).toBeDefined();

    rerender(
      <FieldShell label="Name">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.queryByText("Shown in the key list.")).toBeNull();
  });

  it("renders an error only when one is supplied", () => {
    render(
      <FieldShell label="Name" error="Name is required">
        <input aria-label="Name" />
      </FieldShell>
    );
    expect(screen.getByText("Name is required")).toBeDefined();
  });

  it("associates the label with the control when htmlFor is omitted", () => {
    // The simplest usage the props permit: a label with no explicit id
    // anywhere. Read `for`/`id` directly rather than only through
    // `getByLabelText`, which an `aria-label` on the control could satisfy
    // without a real association ever existing.
    render(
      <FieldShell label="Name">
        <input />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    expect(label.getAttribute("for")).toBe(control.id);
    expect(control.id).not.toBe("");
  });

  it("uses an explicit htmlFor verbatim", () => {
    render(
      <FieldShell label="Name" htmlFor="custom-id">
        <input />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    expect(label.getAttribute("for")).toBe("custom-id");
    expect(control.id).toBe("custom-id");
    expect(label.getAttribute("for")).toBe(control.id);
  });

  it("targets a child's own id rather than the generated one", () => {
    // No `aria-label` here: if the label/control association were broken,
    // `getByLabelText` would find nothing to return, rather than silently
    // succeeding through a second, unrelated accessible-name source.
    render(
      <FieldShell label="Name">
        <input id="caller-id" />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    // Slot merges props onto the child rather than replacing them, so the
    // child's own id wins over the id FieldShell generated for it — and the
    // label has to follow it there, not point at the id FieldShell offered.
    expect(control.id).toBe("caller-id");
    expect(label.getAttribute("for")).toBe("caller-id");
  });

  it("connects description and error to the control via aria-describedby", () => {
    render(
      <FieldShell
        label="Name"
        description="Shown in the key list."
        error="Name is required"
      >
        <input />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    const describedBy = control.getAttribute("aria-describedby") ?? "";
    const ids = describedBy.split(" ").filter(Boolean);
    const description = screen.getByText("Shown in the key list.");
    const error = screen.getByText("Name is required");
    expect(ids).toContain(description.id);
    expect(ids).toContain(error.id);
    expect(description.id).not.toBe("");
    expect(error.id).not.toBe("");
    expect(control.getAttribute("aria-invalid")).toBe("true");
  });

  it("omits aria-describedby ids for messages that are not rendered", () => {
    render(
      <FieldShell label="Name">
        <input />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    // Neither description nor error is present, so the control must not
    // point at ids nothing carries.
    expect(control.getAttribute("aria-describedby")).toBeNull();
    expect(control.getAttribute("aria-invalid")).toBeNull();
  });
});
