// @vitest-environment jsdom
/**
 * What the switcher is responsible for, which is narrower than it looks.
 *
 * It SETS a width and reports which option that width corresponds to. Which
 * tier an edit lands in is `canvas-width.ts`'s answer and has its own suite;
 * what is only true here is that choosing an option emits the tier's own bound,
 * that a width no option could have set selects NOTHING, and that the control
 * is operable from a keyboard.
 *
 * @module breakpoint-switcher.test
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { BreakpointSet } from "./breakpoints";
import { BreakpointSwitcher } from "./breakpoint-switcher";

afterEach(cleanup);

const site = (): BreakpointSet => ({
  viewport: [
    { id: "tablet", label: "Tablet", maxWidth: 991 },
    { id: "mobile", label: "Mobile", maxWidth: 575 },
  ],
  container: [],
});

const options = (): HTMLElement[] => screen.getAllByRole("radio");
const checked = (): HTMLElement[] =>
  options().filter(option => option.getAttribute("aria-checked") === "true");

describe("choosing a tier", () => {
  it("emits the tier's OWN bound, not an index or an id", () => {
    /*
     * The width is the whole output of this control. Emitting an id would push
     * the width lookup onto every host, which is a second place for the
     * canvas's size and the selected tier to disagree.
     */
    const onSelect = vi.fn();
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={onSelect}
        status="ready"
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: /Tablet/ }));

    expect(onSelect).toHaveBeenCalledWith(991);
  });

  it("emits UNDEFINED for the widest, rather than a number", () => {
    /*
     * The unconditional tier has no upper bound, so any number here would be
     * invented — and would make the widest option narrower than the region,
     * putting gutters around a canvas that was already the right size.
     */
    const onSelect = vi.fn();
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={575}
        onSelect={onSelect}
        status="ready"
      />
    );

    fireEvent.click(screen.getByRole("radio", { name: "Full width" }));

    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it("says the WIDTH in each option's accessible name", () => {
    // "Tablet" alone does not say what choosing it will do, and the number is
    // the entire content of the choice. In the name rather than a tooltip, so a
    // screen-reader user gets it.
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(
      screen.getByRole("radio", { name: "Tablet, up to 991 pixels" })
    ).toBeDefined();
  });
});

describe("what the control reports as selected", () => {
  it("selects the option whose bound the canvas is EXACTLY at", () => {
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={991}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(checked()).toHaveLength(1);
    expect(checked()[0]?.getAttribute("aria-label")).toBe(
      "Tablet, up to 991 pixels"
    );
  });

  it("selects NOTHING at a width no option could have set", () => {
    /*
     * The property that separates this control from one that merely reports the
     * live tier. At 700 the tablet rules ARE applying, and the canvas is not at
     * the tablet width — so showing Tablet as chosen would tell an author the
     * box is 991 when it is 700, and clicking Tablet would then look like a
     * no-op that silently resizes.
     *
     * Asserted as an empty set rather than "Tablet is not checked", so a
     * version that selected Mobile instead would also fail.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(checked()).toHaveLength(0);
  });

  it("still names the tier that IS applying at that width", () => {
    // The counterpart to the case above: selecting nothing must not mean saying
    // nothing. The width changed which declarations are live, and that is the
    // fact this control exists to make legible.
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(screen.getByText(/700px/)).toBeDefined();
    expect(screen.getByText(/tablet/)).toBeDefined();
  });

  it("selects the widest when the canvas is UNBOUNDED, which is the control", () => {
    /*
     * Without this, a control that selected nothing under every circumstance
     * would satisfy the empty-set assertion above — the negative there is
     * satisfied by absence, so its meaning depends on this.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(checked()).toHaveLength(1);
    expect(checked()[0]?.getAttribute("aria-label")).toBe("Full width");
  });
});

describe("the gate on the saved read", () => {
  it("is INERT until the saved set has been read", () => {
    /*
     * The same gate the manager beside it carries, and for a reason that is
     * stronger here: until the read answers, the value in hand is the host's
     * config defaults, so sizing the canvas to one of those bounds would make
     * every subsequent edit land in a tier the author never chose.
     *
     * Asserted on the callback as well as on `disabled` — a disabled attribute
     * that some other handler ignores is not a gate.
     */
    const onSelect = vi.fn();
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={onSelect}
        status="loading"
      />
    );

    const tablet = screen.getByRole("radio", { name: /Tablet/ });
    expect((tablet as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(tablet);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("reports nothing as selected while it cannot be trusted", () => {
    // Showing a selection derived from config defaults would state which tier
    // the canvas is at, on the strength of a set the site may never have saved.
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="unavailable"
      />
    );

    expect(checked()).toHaveLength(0);
  });
});

describe("keyboard operation", () => {
  it("moves the selection with the arrow keys", () => {
    // A radio group's expected behaviour, and the reason the roles are worth
    // having: a row of plain buttons gives a keyboard user no way to move
    // between options without leaving and re-entering the group.
    const onSelect = vi.fn();
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={onSelect}
        status="ready"
      />
    );

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowRight" });

    expect(onSelect).toHaveBeenCalledWith(991);
  });

  it("WRAPS at the end rather than stopping", () => {
    // Three options and a left-arrow from the first reaches the last. Stopping
    // dead at an edge is the behaviour a roving tabindex most often gets wrong,
    // and it strands a keyboard user at whichever end they entered from.
    const onSelect = vi.fn();
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={onSelect}
        status="ready"
      />
    );

    fireEvent.keyDown(screen.getByRole("radiogroup"), { key: "ArrowLeft" });

    expect(onSelect).toHaveBeenCalledWith(575);
  });

  it("keeps exactly ONE option in the tab order", () => {
    /*
     * The roving tabindex. Every option reachable by Tab would cost a keyboard
     * user one stop per breakpoint to cross a control they may not be using —
     * and a site may define up to seven per axis.
     *
     * Asserted as a count over the whole group rather than on one element, so a
     * version that gave every option `tabIndex={0}` fails here.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(options().filter(option => option.tabIndex === 0)).toHaveLength(1);
  });

  it("leaves a stop in the tab order at a width matching NO option", () => {
    /*
     * The case a roving tabindex keyed only on the selection gets wrong: with
     * nothing selected there is nothing carrying `tabIndex={0}`, and the whole
     * control drops out of the tab order — unreachable by keyboard at exactly
     * the widths an author reaches by dragging.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(options().filter(option => option.tabIndex === 0)).toHaveLength(1);
  });
});

describe("a site with no viewport breakpoints", () => {
  it("renders NOTHING rather than a control offering one option", () => {
    // "Full width" alone is not a choice; it occupies top-bar space to say the
    // canvas is the width it visibly is. The manager beside it is where tiers
    // are added, so the affordance appears when there is something to switch.
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={{ viewport: [], container: [] }}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(container.firstChild).toBeNull();
  });

  it("DROPS a tier the compiler emits no bound for", () => {
    /*
     * The switcher offers what the SHEET can respond to, not what storage
     * happens to hold. `breakpointContexts` applies its own reading of a stored
     * axis, so a definition it declines to emit a bounded context for has no
     * query anywhere in the compiled page.
     *
     * Offered anyway, picking it resizes the canvas to a width nothing responds
     * to: the box changes size and the page does not reflow, which reads as the
     * feature being broken rather than as a definition the compiler rejected.
     *
     * A non-positive bound is the reachable case — `isUsableWidth` refuses it,
     * and storage is an ordinary record the API or an import can write.
     */
    const rejected = {
      viewport: [
        { id: "tablet", label: "Tablet", maxWidth: 991 },
        { id: "broken", label: "Broken", maxWidth: 0 },
      ],
      container: [],
    } as unknown as BreakpointSet;

    render(
      <BreakpointSwitcher
        breakpoints={rejected}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    // The accepted tier is asserted alongside, so a version rendering no
    // options at all would not pass by dropping this one.
    expect(screen.getByRole("radio", { name: /Tablet/ })).toBeDefined();
    expect(screen.queryByRole("radio", { name: /Broken/ })).toBeNull();
  });

  it("does not count a stored row using the RESERVED base id", () => {
    /*
     * The plugin's own README documents a host config carrying
     * `{ id: "base", label: "Base" }`, and a stored set can hold one too.
     * Passed through, it appears as a tier named "Base" beside the "Full width"
     * option this control already offers — two entries for one thing, one of
     * which cannot be selected meaningfully.
     *
     * Asserted through the rendering rather than on a count, because the count
     * is the mechanism and what the author sees is the property.
     */
    const withReserved = {
      viewport: [{ id: "base", label: "Base", maxWidth: undefined }],
      container: [],
    } as unknown as BreakpointSet;

    const { container } = render(
      <BreakpointSwitcher
        breakpoints={withReserved}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(container.firstChild).toBeNull();
  });
});
