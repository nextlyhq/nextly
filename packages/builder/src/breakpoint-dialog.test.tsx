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
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreakpointDialog } from "./breakpoint-dialog";
import type { BreakpointSet } from "./breakpoints";

function stored(): BreakpointSet {
  return {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  };
}

function open(value: BreakpointSet, onSave = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <BreakpointDialog
      open
      onOpenChange={onOpenChange}
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

/*
 * Matched on either label, because the button reports its own progress.
 *
 * Its accessible name becomes "Saving…" while a write is in flight, and that is
 * deliberate rather than incidental: a disabled button whose text never changed
 * tells a sighted author nothing is happening, and an `aria-label` pinned to the
 * idle wording while the visible text moved on is the label-in-name mismatch
 * WCAG 2.5.3 exists to prevent. The name changes because the button means
 * something different.
 */
const saveButton = (): HTMLButtonElement =>
  screen.getByRole("button", {
    name: /save breakpoints|saving/i,
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

  it("stays open until an async save settles, then closes", async () => {
    /*
     * The close is the destructive half. Until the write lands there is nothing
     * anywhere else holding this draft, so closing on the click means a refusal
     * arrives with the set already gone.
     *
     * Both moments are asserted, and the ORDER is the property: still open
     * while the promise is pending, closed only once it resolves. Asserting the
     * end state alone would pass against a dialog that closed immediately.
     */
    let settle: (value: undefined) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<undefined>(resolve => {
          settle = resolve;
        })
    );
    const onOpenChange = vi.fn();
    open(stored(), onSave, onOpenChange);

    fireEvent.click(saveButton());

    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    // And it says so, rather than looking idle while a write is in flight.
    expect(saveButton().disabled).toBe(true);

    settle(undefined);

    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("keeps the draft on screen when the save is REFUSED", async () => {
    /*
     * The case the whole change exists for. A refused write used to close the
     * dialog anyway, discarding a set the author had just built by hand with
     * nothing left to recover it from.
     *
     * Asserted on three things, because any one alone is satisfiable by a
     * dialog that is simply broken: the reason is shown, the dialog did NOT
     * close, and the edited value is still in its field.
     */
    const onSave = vi.fn(() => Promise.resolve("The server refused this."));
    const onOpenChange = vi.fn();
    open(stored(), onSave, onOpenChange);

    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "768" },
    });
    fireEvent.click(saveButton());

    await waitFor(() =>
      expect(screen.getByText("The server refused this.")).toBeDefined()
    );
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("768")).toBeDefined();
  });

  it("treats a REJECTION as a refusal, not as a save", async () => {
    /*
     * A host that throws is not following the contract, and the author's draft
     * is not the place to make that point. An unhandled rejection would also
     * leave the button disabled forever, so the settled state is asserted too.
     */
    const onSave = vi.fn(() => Promise.reject(new Error("Network down")));
    const onOpenChange = vi.fn();
    open(stored(), onSave, onOpenChange);

    fireEvent.click(saveButton());

    await waitFor(() => expect(screen.getByText("Network down")).toBeDefined());
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(false);
  });

  it("closes at once for a host that saves synchronously", () => {
    // The contract that already existed must not have grown a microtask: a host
    // returning nothing is finished when the call returns.
    const onOpenChange = vi.fn();
    open(stored(), vi.fn(), onOpenChange);

    fireEvent.click(saveButton());

    expect(onOpenChange).toHaveBeenCalledWith(false);
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

describe("a saved breakpoint's id", () => {
  it("cannot be retyped, because stored styles are filed under it", () => {
    // `onSave` carries only the breakpoint set. A rename here would leave every
    // NodeStyles entry keyed by the old id, and the compiler would stop
    // emitting those styles on every page that used them, reporting nothing.
    open(stored());
    const id = screen.getByDisplayValue("tablet") as HTMLInputElement;

    expect(id.readOnly).toBe(true);
  });

  it("survives an unrelated edit byte for byte", () => {
    // The engine files stored styles under the id VERBATIM, so normalising one
    // that arrived with surrounding whitespace re-keys it on a width edit and
    // detaches those styles — underneath a field the author cannot even type
    // in. Trimming looks like tidying and is a rename.
    const value: BreakpointSet = {
      viewport: [{ id: " tablet ", label: "Tablet", maxWidth: 991 }],
      container: [],
    };
    const onSave = open(value);

    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "768" },
    });
    fireEvent.click(saveButton());

    const saved = onSave.mock.calls[0]?.[0] as BreakpointSet;
    expect(saved.viewport[0]?.id).toBe(" tablet ");
  });

  it("is editable on a row added in this session", () => {
    // The separating case: a blanket read-only id would make it impossible to
    // name a NEW breakpoint, so the test must distinguish the two.
    open(stored());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add breakpoint" })[0]
    );

    const blank = screen
      .getAllByRole("textbox")
      .filter(el => (el as HTMLInputElement).value === "");
    expect(blank.length).toBeGreaterThan(0);
    expect(blank.every(el => (el as HTMLInputElement).readOnly === false)).toBe(
      true
    );
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
