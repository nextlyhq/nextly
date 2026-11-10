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

import { BreakpointEditor } from "./breakpoint-editor";
import type { BreakpointSet } from "./breakpoints";

function stored(): BreakpointSet {
  return {
    viewport: [{ id: "tablet", label: "Tablet", maxWidth: 991 }],
    container: [],
  };
}

/**
 * The editor, as a host shows it while editing. `onOpenChange` stands for the
 * host's "editing" state: leaving the editor calls it with `false`.
 */
function open(value: BreakpointSet, onSave = vi.fn(), onOpenChange = vi.fn()) {
  render(
    <BreakpointEditor
      value={value}
      onSave={onSave}
      onClose={() => onOpenChange(false)}
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

  it("freezes the form while a save is in flight", async () => {
    /*
     * The request carries the draft as it was at the click. Left editable, an
     * edit made before the promise settles is not in that request AND is
     * discarded by the close that follows it — the author watches their own
     * change vanish into a save that reported success.
     *
     * Asserted on an attempted EDIT, not only on a disabled attribute: a field
     * can be visibly disabled and still accept a programmatic change, and the
     * property that matters is that the value does not move.
     */
    let settle: (value: undefined) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<undefined>(resolve => {
          settle = resolve;
        })
    );
    open(stored(), onSave);

    fireEvent.click(saveButton());
    expect(onSave).toHaveBeenCalledTimes(1);

    const width = screen.getByDisplayValue("991");
    fireEvent.change(width, { target: { value: "640" } });

    expect(screen.getByDisplayValue("991")).toBeDefined();
    expect(screen.queryByDisplayValue("640")).toBeNull();

    settle(undefined);
    await waitFor(() => expect(saveButton().disabled).toBe(false));
  });

  it("refuses dismissal while a save is in flight", async () => {
    /*
     * Freezing the fields left Cancel untouched. Taken during a pending write,
     * the editor unmounts with the draft: a refusal landing afterwards has
     * nowhere to be shown, and editing again seeds from a read that has not
     * caught up. Escape is pressed too, and leaves nothing either: the editor
     * sits in its host's page, which owns Escape.
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

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    fireEvent.keyDown(document.body, { key: "Escape", code: "Escape" });

    expect(onOpenChange).not.toHaveBeenCalled();

    settle(undefined);
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it("awaits a THENABLE that is not the global Promise", async () => {
    /*
     * `instanceof Promise` answers about one realm. A promise from another
     * window or iframe, or a conforming implementation that is not the global
     * constructor, fails it — and the dialog then closes as though the write
     * were synchronous, so a refusal arriving afterwards is neither shown nor
     * handled.
     *
     * The fixture is a bare thenable rather than a subclass, because a subclass
     * still passes `instanceof` and would leave this green against the defect.
     */
    const notYet = (): void => {};
    let settle: (value: string | undefined) => void = notYet;
    const thenable = {
      then(resolve: (value: string | undefined) => void) {
        settle = resolve;
      },
    };
    const onOpenChange = vi.fn();
    open(
      stored(),
      vi.fn(() => thenable as never),
      onOpenChange
    );

    fireEvent.click(saveButton());

    expect(onOpenChange).not.toHaveBeenCalled();
    expect(saveButton().disabled).toBe(true);

    /*
     * The POPULATION before the property. Assimilating a thenable calls its
     * `then` on a MICROTASK, so settling synchronously here would invoke the
     * placeholder above and assert nothing — the refusal would never be
     * delivered and the failure would read as the dialog ignoring it.
     */
    await waitFor(() => expect(settle).not.toBe(notYet));
    settle("The server refused this.");

    await waitFor(() =>
      expect(screen.getByText("The server refused this.")).toBeDefined()
    );
    expect(onOpenChange).not.toHaveBeenCalled();
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

  it("stays open with the draft, and says nothing, when the host KEPT it", async () => {
    // `null`: the author went back from a step the host showed before saving.
    // Neither a save (the editor would close) nor a refusal (a reason shown).
    const onSave = vi.fn(() => Promise.resolve(null));
    const onOpenChange = vi.fn();
    open(stored(), onSave, onOpenChange);

    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "768" },
    });
    fireEvent.click(saveButton());

    await waitFor(() => expect(saveButton().disabled).toBe(false));
    expect(onSave).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("768")).toBeDefined();
    expect(screen.getByRole("status").textContent).toBe("");
  });

  it("holds Save while the host says why, keeping the draft and saying it", () => {
    const onSave = vi.fn();
    const { rerender } = render(
      <BreakpointEditor
        value={stored()}
        onSave={onSave}
        onClose={vi.fn()}
        blocked="Another removal is running."
      />
    );
    fireEvent.change(screen.getByDisplayValue("991"), {
      target: { value: "768" },
    });
    expect(saveButton().disabled).toBe(true);
    expect(screen.getByRole("status").textContent).toBe(
      "Another removal is running."
    );
    fireEvent.click(saveButton());
    expect(onSave).not.toHaveBeenCalled();
    // Cleared: the same draft can be saved.
    rerender(
      <BreakpointEditor value={stored()} onSave={onSave} onClose={vi.fn()} />
    );
    expect(saveButton().disabled).toBe(false);
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
    // The id is shown nowhere, and renaming a stored breakpoint keeps it.
    const onSave = open(stored());
    expect(screen.queryByDisplayValue("tablet")).toBeNull();
    fireEvent.change(screen.getByDisplayValue("Tablet"), {
      target: { value: "Small screens" },
    });
    fireEvent.click(saveButton());

    const saved = onSave.mock.calls[0]?.[0] as BreakpointSet;
    expect(saved.viewport[0]).toMatchObject({
      id: "tablet",
      label: "Small screens",
    });
  });

  it("names a new breakpoint's id after it, and says a clash in plain words", () => {
    const onSave = open(stored());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add breakpoint" })[0]
    );
    const names = screen.getAllByLabelText("Name");
    fireEvent.change(names[names.length - 1] as HTMLElement, {
      target: { value: "Wide Phone" },
    });
    const widths = screen.getAllByLabelText("Up to");
    fireEvent.change(widths[widths.length - 1] as HTMLElement, {
      target: { value: "700" },
    });
    fireEvent.click(saveButton());
    const saved = onSave.mock.calls[0]?.[0] as BreakpointSet;
    expect(saved.viewport.map(def => def.id)).toContain("wide-phone");

    // A name that makes no id, or one already taken, still saves: the id
    // falls back, or is numbered, and the author never sees it.
    cleanup();
    const again = open(stored());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add breakpoint" })[0]
    );
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add breakpoint" })[0]
    );
    const moreNames = screen.getAllByLabelText("Name");
    const moreWidths = screen.getAllByLabelText("Up to");
    fireEvent.change(moreNames[moreNames.length - 2] as HTMLElement, {
      target: { value: "携帯" },
    });
    fireEvent.change(moreWidths[moreWidths.length - 2] as HTMLElement, {
      target: { value: "500" },
    });
    fireEvent.change(moreNames[moreNames.length - 1] as HTMLElement, {
      target: { value: "Tablet!" },
    });
    fireEvent.change(moreWidths[moreWidths.length - 1] as HTMLElement, {
      target: { value: "800" },
    });
    expect(saveButton().disabled).toBe(false);
    fireEvent.click(saveButton());
    const ids = (again.mock.calls[0]?.[0] as BreakpointSet).viewport.map(
      def => def.id
    );
    expect(ids).toEqual(expect.arrayContaining(["breakpoint", "tablet-2"]));

    // The same NAME twice is still refused, and said about the name.
    cleanup();
    open(stored());
    fireEvent.click(
      screen.getAllByRole("button", { name: "Add breakpoint" })[0]
    );
    const twice = screen.getAllByLabelText("Name");
    const last = twice[twice.length - 1] as HTMLElement;
    fireEvent.change(last, { target: { value: " tablet" } });
    expect(saveButton().disabled).toBe(true);
    expect(last.getAttribute("aria-invalid")).toBe("true");
    expect(
      screen.getByText('Another breakpoint is already called "tablet".')
    ).toBeTruthy();
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

describe("where each breakpoint applies", () => {
  it("says it in the device buttons' words, from the next narrower one up", () => {
    open({
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "mobile", label: "Mobile", maxWidth: 575 },
      ],
      container: [],
    });
    expect(screen.getByText("576–991px")).toBeTruthy();
    expect(screen.getByText("up to 575px")).toBeTruthy();
    // The base is the fixed first row, not an editable one.
    expect(screen.getByText("the base, always applies")).toBeTruthy();
  });

  it("starts just above a fractional width, not a whole pixel past it", () => {
    open({
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 768.5 },
        { id: "mobile", label: "Mobile", maxWidth: 480.5 },
      ],
      container: [],
    });
    expect(screen.getByText("above 480.5px, up to 768.5px")).toBeTruthy();
  });
});

describe("telling the host about a save", () => {
  it("says when a save starts and when it settles", async () => {
    let settle: (value: undefined) => void = () => {};
    const onSave = vi.fn(
      () =>
        new Promise<undefined>(resolve => {
          settle = resolve;
        })
    );
    const onSavingChange = vi.fn();
    render(
      <BreakpointEditor
        value={stored()}
        onSave={onSave}
        onClose={vi.fn()}
        onSavingChange={onSavingChange}
      />
    );
    fireEvent.click(saveButton());
    expect(onSavingChange).toHaveBeenLastCalledWith(true);
    settle(undefined);
    await waitFor(() => expect(onSavingChange).toHaveBeenLastCalledWith(false));
  });
});

describe("container widths", () => {
  it("offers the first one on a site that has none", () => {
    open(stored());
    expect(screen.queryByText("Container widths")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: "Add a container width" })
    );
    expect(screen.getByText("Container widths")).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: "Add a container width" })
    ).toBeNull();
  });
});
