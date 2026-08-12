// @vitest-environment jsdom
/**
 * The dialog's contract is that a host can store whatever it receives without
 * re-checking it: `onSave` fires only for a set that produces no issues, and
 * every width arrives as a NUMBER even though it was typed as text.
 *
 * Both halves are load-bearing and neither is visible in the markup. A dialog
 * that saved the draft verbatim would put `"991"` in settings, where the
 * compiler reads `maxWidth` as a number, finds a string, and drops the
 * definition — the same silent loss the validation exists to prevent, arriving
 * through the screen that was supposed to prevent it.
 */
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreakpointDialog } from "./breakpoint-dialog";
import type { BreakpointSet } from "../lib/breakpoints";

function stored(): BreakpointSet {
  return {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  };
}

function open(value: BreakpointSet, onSave = vi.fn()) {
  render(
    <BreakpointDialog
      open
      onOpenChange={vi.fn()}
      value={value}
      onSave={onSave}
    />
  );
  return onSave;
}

// Rendered trees are torn down between tests; without this the next render
// finds two of every field and the queries below fail on ambiguity rather than
// on the property under test.
afterEach(cleanup);

const saveButton = (): HTMLButtonElement =>
  screen.getByRole("button", {
    name: "Save breakpoints",
  }) as HTMLButtonElement;

describe("saving", () => {
  it("hands the host numbers, not the text that was typed", () => {
    const onSave = open(stored());

    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "768" },
    });
    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    const saved = onSave.mock.calls[0]?.[0] as BreakpointSet;
    expect(saved.viewport[0]?.maxWidth).toBe(768);
    // Not `toEqual("768")`: a string passes a loose comparison and is exactly
    // the value the compiler discards.
    expect(typeof saved.viewport[0]?.maxWidth).toBe("number");
  });

  it("is refused while a definition would be dropped", () => {
    const onSave = open(stored());

    // A viewport definition with no bound is discarded at compile time.
    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "" },
    });

    expect(saveButton().disabled).toBe(true);
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
  });

  it("says how many problems remain", () => {
    open(stored());
    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "0" },
    });

    expect(screen.getByRole("status").textContent).toContain(
      "1 problem to fix before saving"
    );
  });

  it("is offered for a set with no problems", () => {
    // The positive control. Without it, every assertion above is satisfied by a
    // dialog whose Save is permanently disabled.
    open(stored());
    expect(saveButton().disabled).toBe(false);
  });
});

describe("reporting a problem", () => {
  it("marks the field and describes it to assistive technology", () => {
    open(stored());
    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "-5" },
    });

    const width = screen.getByDisplayValue("-5");
    expect(width.getAttribute("aria-invalid")).toBe("true");

    const describedBy = width.getAttribute("aria-describedby");
    expect(describedBy).not.toBeNull();
    // The reference has to RESOLVE. Pointing at an absent element leaves the
    // control described by nothing, which reads as no error at all.
    expect(
      document.getElementById(describedBy as string)?.textContent
    ).toContain("positive number");
  });

  it("leaves a healthy field undescribed", () => {
    open(stored());
    expect(
      screen.getByDisplayValue("991").hasAttribute("aria-describedby")
    ).toBe(false);
  });
});

describe("the draft", () => {
  it("does not mutate the set it was given", () => {
    const value = stored();
    open(value);

    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "600" },
    });

    expect(value.viewport[0]?.maxWidth).toBe(991);
  });
});
