// @vitest-environment jsdom
/**
 * A field's width is a NAME, not a measurement, and each name caps the control
 * rather than the row. The row still spans its container so the label and the
 * error message align with everything above and below them; only the control
 * is constrained. Asserting the cap on the row instead would pass while
 * producing ragged labels.
 *
 * `FieldShell` owns its own prop merge with `cloneElement` rather than
 * delegating to Radix `Slot`, so these cases are written against the merge
 * RULES directly — an explicitly-present `undefined`, an existing
 * `aria-describedby` to compose with, an `aria-invalid={false}` a rendered
 * error must override — rather than against whatever a library's own
 * precedence happened to produce.
 */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { resetDevWarnings } from "../lib/dev-warn";

import { FieldShell } from "./field-shell";

// Several cases below share the label text "Name" and query for it through
// the shared jsdom document via `screen`, so a leftover mount from an earlier
// case would make a later `getByLabelText`/`getByText` see more than one
// match. Unmounting after every test keeps each case reading only its own DOM.
afterEach(() => {
  cleanup();
  resetDevWarnings();
});

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

  it("associates the label with the control when the child has no id", () => {
    // The simplest usage the props permit: a label with no explicit id
    // anywhere, and a control with no `aria-label` either. Read `for`/`id`
    // directly rather than only through `getByLabelText`: an `aria-label` on
    // the control would satisfy `getByLabelText` through a second,
    // independent accessible-name source even if `htmlFor`/`id` were never
    // wired up at all, which is exactly the failure this case exists to rule
    // out.
    render(
      <FieldShell label="Name">
        <input />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    expect(control.id).not.toBe("");
    expect(label.getAttribute("for")).toBe(control.id);
  });

  it("targets a child's own id rather than the generated one", () => {
    render(
      <FieldShell label="Name">
        <input id="caller-id" />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    // The child set its own id, so the merge keeps it rather than the
    // generated one — and the label has to follow it there.
    expect(control.id).toBe("caller-id");
    expect(label.getAttribute("for")).toBe("caller-id");
  });

  it("falls back to a generated id when the child's id is explicitly undefined", () => {
    // `id={undefined}` is a key PRESENT on the child's props with value
    // `undefined` — distinct from omitting the prop entirely, and the case a
    // naive object spread would let win, leaving the control with no id at
    // all. The merge must treat this the same as no id being supplied.
    render(
      <FieldShell label="Name">
        <input id={undefined} />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    expect(control.id).not.toBe("");
    expect(label.getAttribute("for")).toBe(control.id);
  });

  it("uses an explicit htmlFor verbatim, and still matches the control's id", () => {
    render(
      <FieldShell label="Name" htmlFor="custom-id">
        <input />
      </FieldShell>
    );
    const label = screen.getByText("Name");
    const control = screen.getByLabelText("Name");
    expect(label.getAttribute("for")).toBe("custom-id");
    expect(control.id).toBe("custom-id");
  });

  it("composes a child's existing aria-describedby with the shell's message ids", () => {
    render(
      <FieldShell
        label="Name"
        description="Shown in the key list."
        error="Name is required"
      >
        <input aria-describedby="unit-hint" />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    const describedBy = control.getAttribute("aria-describedby") ?? "";
    const ids = describedBy.split(" ").filter(Boolean);
    const description = screen.getByText("Shown in the key list.");
    const error = screen.getByText("Name is required");
    // The child's own reference survives the merge...
    expect(ids).toContain("unit-hint");
    // ...composed with, not replaced by, both of the shell's own message ids.
    expect(ids).toContain(description.id);
    expect(ids).toContain(error.id);
    expect(ids).toHaveLength(3);
  });

  it("omits aria-describedby entirely when nothing is rendered and the child had none", () => {
    render(
      <FieldShell label="Name">
        <input />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    // Neither description nor error is present, and the child carried no
    // aria-describedby of its own, so the control must not point at ids
    // nothing carries, and must not carry an empty attribute either.
    expect(control.getAttribute("aria-describedby")).toBeNull();
  });

  it("forces aria-invalid when a rendered error meets a child's own false", () => {
    render(
      <FieldShell label="Name" error="Name is required">
        <input aria-invalid={false} />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    // The child explicitly claimed it was valid; a visibly-rendered error
    // must win over that claim rather than being suppressed by it.
    expect(control.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("Name is required")).toBeDefined();
  });

  it("defers to the child's own aria-invalid when there is no error", () => {
    render(
      <FieldShell label="Name">
        <input aria-invalid={true} />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    // With no error to force, the control's own claim about itself passes
    // through unmodified rather than being cleared to absent.
    expect(control.getAttribute("aria-invalid")).toBe("true");
  });

  it("omits aria-invalid when there is no error and the child set none", () => {
    render(
      <FieldShell label="Name">
        <input />
      </FieldShell>
    );
    const control = screen.getByLabelText("Name");
    expect(control.getAttribute("aria-invalid")).toBeNull();
  });

  it("warns in development and renders unmodified for a Fragment child", () => {
    // No mechanism forwards props through a Fragment, so the association and
    // the ARIA wiring silently disconnect. `FieldShell` cannot rule this out
    // at compile time, so it has to report it at runtime instead.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <FieldShell label="Name">
          <>
            <input aria-label="Inner" />
          </>
        </FieldShell>
      );
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain("Fragment");
      // The inner input still renders — this is a warning, not a throw — but
      // it never received an id, so nothing connects it to the label.
      const control = screen.getByLabelText("Inner");
      expect(control.id).toBe("");
    } finally {
      warn.mockRestore();
    }
  });

  it("stays silent for a single, non-Fragment child", () => {
    // The positive control for the Fragment case above: without it, a
    // warning that fired unconditionally would pass that case too.
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      render(
        <FieldShell label="Name">
          <input />
        </FieldShell>
      );
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});
