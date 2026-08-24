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
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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
      <BreakpointManager value={empty()} onSave={vi.fn()} status="loading" />
    );

    expect(trigger().disabled).toBe(true);
    fireEvent.click(trigger());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("says UNAVAILABLE after a failed read, not still loading", () => {
    /*
     * Both non-ready states withhold the dialog for the same reason — the value
     * in hand is the host's config defaults — but they are not the same thing to
     * say. Told "still loading" after a permission denial or a dropped request,
     * an author waits for something that already finished, and the only signal
     * they have says to keep waiting.
     *
     * Asserted against the loading wording as well as for its own, so a state
     * that merely fell through to the same string would fail.
     */
    render(
      <BreakpointManager
        value={empty()}
        onSave={vi.fn()}
        status="unavailable"
      />
    );

    expect(
      screen.getByRole("button", { name: "Breakpoints: unavailable" })
    ).toBeDefined();
    expect(
      screen.queryByRole("button", { name: "Breakpoints: still loading" })
    ).toBeNull();
    // And it is still withheld, which is the property the wording qualifies.
    expect(trigger().disabled).toBe(true);
  });

  it("does not release the hold when the host rebuilds an EQUAL value", async () => {
    /*
     * The counterpart to the resurrection case, and the reason the release is
     * asked of content rather than identity: the prop contract does not promise
     * a stable reference, so a parent render that rebuilds an equal object is
     * within its rights. Released on that, the hold lifts before the read has
     * moved at all, and reopening seeds the dialog from the old set.
     *
     * The rebuilt value is a fresh object with the SAME contents, which is
     * exactly what identity comparison cannot tell from a real change.
     */
    const onSave = vi.fn((_next: BreakpointSet) => Promise.resolve(undefined));
    const { rerender } = render(
      <BreakpointManager value={defined()} onSave={onSave} status="ready" />
    );

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove Mobile" }));
    fireEvent.click(
      screen.getByRole("button", { name: /save breakpoints|saving/i })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // A fresh object, equal in content — the read has NOT caught up.
    rerender(
      <BreakpointManager value={defined()} onSave={onSave} status="ready" />
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Breakpoints: 1 defined" })
      ).toBeDefined()
    );
  });

  it("opens once it HAS been read, which is the control", () => {
    // Without this, a manager that never opened would satisfy the case above
    // and the feature would be unreachable rather than merely gated.
    render(
      <BreakpointManager value={defined()} onSave={vi.fn()} status="ready" />
    );

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
    render(
      <BreakpointManager value={defined()} onSave={vi.fn()} status="ready" />
    );

    expect(
      screen.getByRole("button", { name: "Breakpoints: 2 defined" })
    ).toBeDefined();
  });

  it("reports ZERO for a site that has defined none", () => {
    // The state the count exists to distinguish, and the one an off-by-one
    // counting the base context would report as "1 breakpoint".
    render(
      <BreakpointManager value={empty()} onSave={vi.fn()} status="ready" />
    );

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

    render(
      <BreakpointManager value={withReserved} onSave={vi.fn()} status="ready" />
    );

    expect(
      screen.getByRole("button", { name: "Breakpoints: 0 defined" })
    ).toBeDefined();
  });

  it("hides a stored base row, which would otherwise deadlock Save", () => {
    /*
     * The plugin's own README documents a host config carrying
     * `{ id: "base", label: "Base" }`, and a stored set can carry one too —
     * while `validateBreakpoints` reports that id as RESERVED, because the
     * compiler claims it before reading any stored definition.
     *
     * Passed through, the dialog renders it as an ordinary read-only row and
     * Save stays disabled for as long as it is there: an author on the
     * documented configuration cannot save breakpoints at all until they delete
     * a row the interface presents as built in.
     *
     * Asserted on Save being ENABLED rather than only on the row's absence. The
     * absence is the mechanism; being able to save is the property, and a
     * future change that hid the row while still validating it would pass an
     * absence check and leave the deadlock exactly where it was.
     */
    const documented = {
      viewport: [
        { id: "base", label: "Base" },
        { id: "tablet", label: "Tablet", maxWidth: 1024 },
      ],
      container: [],
    } as unknown as BreakpointSet;

    render(
      <BreakpointManager value={documented} onSave={vi.fn()} status="ready" />
    );

    // The count follows the same rule, so the two cannot disagree. Asserted
    // BEFORE opening: the dialog takes the page out of the accessibility tree
    // behind it, so the trigger is unreachable while it is up.
    expect(
      screen.getByRole("button", { name: "Breakpoints: 1 defined" })
    ).toBeDefined();

    fireEvent.click(trigger());

    expect(screen.queryAllByDisplayValue("base")).toHaveLength(0);
    expect(
      (
        screen.getByRole("button", {
          name: /save breakpoints|saving/i,
        }) as HTMLButtonElement
      ).disabled
    ).toBe(false);
  });

  it("answers from the set it just wrote, not the stale read", async () => {
    /*
     * A successful write resolves before the query it invalidates has
     * refetched, and the read reports `isPending` rather than background
     * fetching — so for a moment `value` is still the PREVIOUS set while the
     * trigger is ready and the dialog will reopen.
     *
     * Seeded from `value` there, an author who saves and immediately reopens
     * sees the old set, and saving that draft overwrites the write that had
     * just succeeded.
     *
     * Driven by REMOVING a row rather than adding one, because removal needs a
     * single unambiguous control and leaves a set that is still valid — an
     * added row is three empty fields, and a draft that never became savable
     * would leave this passing on a save that never happened.
     */
    // Typed so the recorded call has a readable argument: an untyped `vi.fn`
    // records `[]`, and reading index 0 off it is a type error rather than the
    // assertion this test is making.
    const onSave = vi.fn((_next: BreakpointSet) => Promise.resolve(undefined));
    render(
      <BreakpointManager value={defined()} onSave={onSave} status="ready" />
    );

    expect(
      screen.getByRole("button", { name: "Breakpoints: 2 defined" })
    ).toBeDefined();

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove Mobile" }));
    fireEvent.click(
      screen.getByRole("button", { name: /save breakpoints|saving/i })
    );

    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave.mock.calls[0]?.[0].viewport).toHaveLength(1);

    /*
     * `value` has NOT changed — the refetch has not landed — so the trigger
     * must answer from what was written. Reading 2 here is the defect: it means
     * the surface is still describing the set the write replaced.
     */
    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Breakpoints: 1 defined" })
      ).toBeDefined()
    );
  });

  it("does not resurrect an old write when the read returns to its old value", async () => {
    /*
     * The optimistic hold has to be CLEARED, not merely stopped being consulted.
     *
     * `resolveSiteStyle` hands back the host's config OBJECT when nothing is
     * stored, and that reference is memoised — so a site that saves a set and
     * later has the stored section cleared through the API or an import sees
     * `value` return to the very object it was at the save. Left in state, the
     * hold would match a second time and an old write would become authoritative
     * over the truth the server and canvas had both moved back to.
     *
     * The same object is passed back deliberately: a fresh but equal one would
     * not reproduce the defect, and the test would pass against the version that
     * never clears.
     */
    const configObject = defined();
    const other = empty();
    const onSave = vi.fn((_next: BreakpointSet) => Promise.resolve(undefined));

    const { rerender } = render(
      <BreakpointManager value={configObject} onSave={onSave} status="ready" />
    );

    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole("button", { name: "Remove Mobile" }));
    fireEvent.click(
      screen.getByRole("button", { name: /save breakpoints|saving/i })
    );
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));

    // The read moves — the hold must be released here, permanently.
    rerender(
      <BreakpointManager value={other} onSave={onSave} status="ready" />
    );
    // And then returns to the very object it was at the save.
    rerender(
      <BreakpointManager value={configObject} onSave={onSave} status="ready" />
    );

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Breakpoints: 2 defined" })
      ).toBeDefined()
    );
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
      <BreakpointManager value={empty()} onSave={vi.fn()} status="ready" />
    );

    rerender(
      <BreakpointManager value={defined()} onSave={vi.fn()} status="ready" />
    );
    fireEvent.click(trigger());

    expect(screen.getByDisplayValue("991")).toBeDefined();
  });
});
