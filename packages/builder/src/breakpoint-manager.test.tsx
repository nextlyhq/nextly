// @vitest-environment jsdom
/**
 * What the trigger is responsible for, which is narrower than it looks.
 *
 * The dialog has its own suite and the validation has another; what is only
 * true here is the GATE — that a manager whose saved set has not been read yet
 * cannot be opened — and the count the trigger reports. Both are the kind of
 * thing that looks obviously right and is satisfied by a component that does
 * nothing at all, so each is asserted against its own opposite.
 *
 * @module breakpoint-manager.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { BreakpointManager } from "./breakpoint-manager";
import type { BreakpointSet } from "./breakpoints";

afterEach(cleanup);

const defined = (): BreakpointSet => ({
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
});

const empty = (): BreakpointSet => ({ viewport: [], container: [] });

const trigger = (): HTMLButtonElement =>
  screen.getByRole("button", { name: /breakpoints/i }) as HTMLButtonElement;

describe("the breakpoint trigger", () => {
  it("cannot be opened before the saved set has been read", () => {
    /*
     * The gate that matters, and the reason it is not cosmetic: until the
     * stored style answers, the value passed here is the host's CONFIG
     * DEFAULTS. Opening on it would show a set the site never chose, and saving
     * from that draft would overwrite the site's real breakpoints with defaults
     * the author never saw.
     *
     * Asserted on the dialog's absence as well as the disabled attribute — a
     * button can be disabled and still have had its dialog mounted beside it.
     */
    render(
      <BreakpointManager value={empty()} onSave={vi.fn()} ready={false} />
    );

    expect(trigger().disabled).toBe(true);
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens once it HAS been read, which is the control", () => {
    // Without this, a manager that never opened would satisfy the case above
    // and the feature would be unreachable rather than merely gated.
    render(<BreakpointManager value={defined()} onSave={vi.fn()} ready />);

    expect(trigger().disabled).toBe(false);
    fireEvent.click(trigger());
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("says how many the site defines, in the accessible name", () => {
    /*
     * In the NAME rather than only in the glyph beside it: a screen-reader user
     * otherwise reaches a button called "Breakpoints" that gives no hint whether
     * the site has any, which is the one thing the label is worth showing.
     */
    render(<BreakpointManager value={defined()} onSave={vi.fn()} ready />);

    expect(
      screen.getByRole("button", { name: "Breakpoints: 2 defined" })
    ).toBeDefined();
  });

  it("reports ZERO for a site that has defined none", () => {
    // The state the count exists to distinguish, and the one an off-by-one
    // counting the base context would report as "1 breakpoint".
    render(<BreakpointManager value={empty()} onSave={vi.fn()} ready />);

    expect(
      screen.getByRole("button", { name: "Breakpoints: 0 defined" })
    ).toBeDefined();
  });

  it("does not count a stored definition using the reserved base id", () => {
    /*
     * Not reachable through the dialog, and reachable through the record.
     * `validateBreakpoints` refuses to SAVE a definition whose id is `base`, so
     * the editor cannot produce one — but the site style is an ordinary stored
     * single that the API, an import or a migration can write directly, and the
     * value here is read from that record rather than from the dialog.
     *
     * Counted, the reserved id inflates the total by one, and it does so for a
     * site that has defined no breakpoints at all — reporting "1" for the exact
     * state the label exists to distinguish from having some.
     */
    const withReserved = {
      viewport: [{ id: "base", label: "Base", maxWidth: undefined }],
      container: [],
    } as unknown as BreakpointSet;

    render(<BreakpointManager value={withReserved} onSave={vi.fn()} ready />);

    expect(
      screen.getByRole("button", { name: "Breakpoints: 0 defined" })
    ).toBeDefined();
  });

  it("seeds the dialog from the set it is given WHEN OPENED", () => {
    /*
     * Mounting the dialog only while open is what makes this true. Kept
     * mounted, a set that arrived in the background — the stored read landing a
     * moment after the editor booted is exactly that — would sit behind a
     * closed dialog, and the author would open it onto whatever was current at
     * boot.
     */
    const { rerender } = render(
      <BreakpointManager value={empty()} onSave={vi.fn()} ready />
    );

    rerender(<BreakpointManager value={defined()} onSave={vi.fn()} ready />);
    fireEvent.click(trigger());

    expect(screen.getByDisplayValue("991")).toBeDefined();
  });
});
