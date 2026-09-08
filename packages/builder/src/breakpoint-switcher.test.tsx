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

/*
 * The tier indicator, read from the live region rather than by text.
 *
 * A text query would match the option BUTTON of the same name — "Tablet"
 * appears on both — so an assertion phrased that way passes whether or not the
 * indicator rendered at all, which is the one thing these cases are about.
 */
const appliedNote = (root: HTMLElement): HTMLElement | null =>
  root.querySelector<HTMLElement>("[aria-live]");

/**
 * What the live region is SAYING, which is what varies.
 *
 * The element itself is mounted from the first render — a live region is
 * registered when it enters the accessibility tree, and content arriving in the
 * same insertion is often not announced — so its presence is not the signal and
 * asserting on it would pass whatever the control reports.
 */
const applied = (root: HTMLElement): string =>
  appliedNote(root)?.textContent ?? "";

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

  it("emits the width at which BASE applies, for the unconditional tier", () => {
    /*
     * It used to emit `undefined` — fill the region — on the reasoning that the
     * unconditional tier has no upper bound so any number would be invented.
     * The number is not invented: it is one past the widest bound, which is the
     * narrowest width the site's own tiers leave to base.
     *
     * And filling the region does not select base wherever the region is
     * narrower than the widest bound, which is the ordinary case — around 912px
     * of canvas on the supported 1280px shell against a tablet bound of 991. It
     * put every edit in tablet while this control read as the widest tier, so
     * the one option naming the tier an author most often wants was the one
     * that could not reach it. The canvas is scaled to fit rather than gaining
     * gutters, which is what makes a real width affordable here.
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

    fireEvent.click(
      screen.getByRole("radio", { name: "Full width, from 992 pixels" })
    );

    // One past the widest bound this site declares, not a chosen number.
    expect(onSelect).toHaveBeenCalledWith(992);
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
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={700}
        appliedWidth={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(applied(container)).toBe("700px · Tablet");
  });

  it("names the tier by its LABEL, not by its stored id", () => {
    /*
     * The id is an addressing detail an author never chose and may never have
     * seen — a site is free to key its tablet tier `bp_2`. Reporting it here
     * would put a string from the storage layer in front of the author at the
     * one moment the control is explaining itself.
     */
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={{
          viewport: [{ id: "bp_2", label: "Tablet", maxWidth: 991 }],
          container: [],
        }}
        width={700}
        appliedWidth={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(applied(container)).toBe("700px · Tablet");
  });

  it("reports the tier a NARROW REGION put the canvas in, at the widest option", () => {
    /*
     * The case the mount actually produces, and the one this indicator exists
     * for. `undefined` width asks for the full region; a region narrower than
     * the widest tier's bound hands the box less, and the narrower tier is then
     * what the browser paints and what an edit lands in.
     *
     * Without this the author sees "Full width" selected, edits what they
     * believe is the base tier, and every value silently goes to tablet — the
     * exact state where what you edit disagrees with what you see.
     *
     * The selection is asserted alongside, because the honest answer is BOTH:
     * the author did ask for the full width, and the box is in tablet.
     */
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        appliedWidth={900}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(checked()[0]?.getAttribute("aria-label")).toBe(
      "Full width, from 992 pixels"
    );
    expect(applied(container)).toBe("900px · Tablet");
  });

  it("says NOTHING at the widest option when the region honoured it", () => {
    /*
     * The control on the case above, and Gutenberg's own finding: a badge at
     * the widest tier is actively confusing, because edits there apply to every
     * breakpoint rather than overriding one.
     *
     * Without this, a version that showed the indicator unconditionally would
     * satisfy every assertion above.
     */
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        appliedWidth={1400}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(applied(container)).toBe("");
    /*
     * MOUNTED while empty. A live region is registered when it enters the
     * accessibility tree, so one that appears together with its first text is
     * often not announced — and the first tier change is the announcement that
     * matters most.
     */
    expect(appliedNote(container)).not.toBeNull();
  });

  it("says nothing about a box that has NOT been measured", () => {
    /*
     * `appliedWidth` is undefined until the canvas reports its first
     * measurement, and that is a real state rather than a missing default.
     * Falling back to the REQUESTED width here would state a tier for a box
     * nobody has looked at — and the request is a ceiling the region may not
     * have honoured, so it is precisely the number that could be wrong.
     */
    const { container } = render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={700}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(applied(container)).toBe("");
    /*
     * MOUNTED while empty. A live region is registered when it enters the
     * accessibility tree, so one that appears together with its first text is
     * often not announced — and the first tier change is the announcement that
     * matters most.
     */
    expect(appliedNote(container)).not.toBeNull();
  });

  it("stays SELECTED after choosing the unconditional tier's own width", () => {
    /*
     * Choosing that option sets a real width now, and it is no tier's BOUND —
     * so a match computed from the bounded tiers is false the moment it is
     * pressed. The canvas sizes correctly and edits base; the control reports
     * `aria-checked="false"` on every radio and reads as having no selection.
     *
     * A press that visibly deselects everything is worse than one that does
     * nothing: it says the choice was refused while the edit it enabled is
     * quietly landing where the author wanted.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={992}
        appliedWidth={992}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(checked()).toHaveLength(1);
    expect(checked()[0]?.getAttribute("aria-label")).toBe(
      "Full width, from 992 pixels"
    );
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
    expect(checked()[0]?.getAttribute("aria-label")).toBe(
      "Full width, from 992 pixels"
    );
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

describe("a stored set the compiler has to reconcile", () => {
  it("offers ONE option per id when a set carries the id twice", () => {
    /*
     * A set written through the API or an import can carry two rows with one
     * id. `breakpointContexts` claims each id once, so the sheet has a single
     * tier — but a control built from the raw definitions keeps both, giving
     * two radios that share a React key and a bound, one of which can never be
     * selected because the match resolves to the first.
     *
     * Asserted as a count over the whole group rather than "Tablet appears
     * once", so a version emitting two DIFFERENTLY-labelled duplicates fails
     * here too.
     */
    render(
      <BreakpointSwitcher
        breakpoints={{
          viewport: [
            { id: "tablet", label: "Tablet", maxWidth: 991 },
            { id: "tablet", label: "Tablet Copy", maxWidth: 700 },
          ],
          container: [],
        }}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    // Full width, and one tablet.
    expect(options()).toHaveLength(2);
  });

  it("offers ONE radio when two tiers share a bound", () => {
    /*
     * Distinct ids, so `breakpointContexts` emits BOTH — this is not the
     * duplicate-id case. Selecting a tier only sets a width, so two radios
     * emitting 991 are not two choices: the match resolves to one and clicking
     * the other silently selects it.
     *
     * The one kept is the tier the browser paints: both are emitted into a
     * single at-rule in order, so the later declaration wins.
     */
    render(
      <BreakpointSwitcher
        breakpoints={{
          viewport: [
            { id: "alpha", label: "Alpha", maxWidth: 991 },
            { id: "beta", label: "Beta", maxWidth: 991 },
          ],
          container: [],
        }}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(options()).toHaveLength(2); // Full width, and one of the two.
    expect(
      screen.getByRole("radio", { name: "Beta, up to 991 pixels" })
    ).toBeDefined();
  });

  it("labels the surviving tier from the definition the compiler KEPT", () => {
    /*
     * Measured: among rows sharing an id the compiler keeps the WIDEST, not the
     * first stored. A label looked up by id alone therefore names the surviving
     * tier after the row the sheet discarded — here the control would offer a
     * 991px tier called "Draft".
     *
     * The stored order puts the discarded row FIRST deliberately: with the kept
     * row first, a by-id lookup would produce the right answer by accident and
     * this case could not fail.
     */
    render(
      <BreakpointSwitcher
        breakpoints={{
          viewport: [
            { id: "tablet", label: "Draft", maxWidth: 700 },
            { id: "tablet", label: "Tablet", maxWidth: 991 },
          ],
          container: [],
        }}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(
      screen.getByRole("radio", { name: "Tablet, up to 991 pixels" })
    ).toBeDefined();
    expect(screen.queryByRole("radio", { name: /Draft/ })).toBeNull();
  });
});

describe("where focus goes when the keyboard moves the selection", () => {
  it("moves FOCUS to the option the arrow key selected", () => {
    /*
     * The roving tabindex makes every unselected option `tabIndex={-1}`, so
     * focus left behind is stranded on a button that is neither checked nor in
     * the tab order. Assistive technology announces nothing for the option that
     * just became selected, and every further arrow press changes a radio the
     * user cannot hear.
     *
     * Asserted on `document.activeElement` rather than on a focus handler
     * firing, because what matters is where focus ENDED UP.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    const group = screen.getByRole("radiogroup");
    options()[0]?.focus();
    fireEvent.keyDown(group, { key: "ArrowRight" });

    expect(document.activeElement).toBe(options()[1]);
  });

  it("leaves focus alone when the control is not ready", () => {
    /*
     * The control. Without it, a version that focused on every key event —
     * including while disabled, where no selection can be made — would satisfy
     * the case above.
     */
    render(
      <BreakpointSwitcher
        breakpoints={site()}
        width={undefined}
        onSelect={vi.fn()}
        status="loading"
      />
    );

    const group = screen.getByRole("radiogroup");
    const before = document.activeElement;
    fireEvent.keyDown(group, { key: "ArrowRight" });

    expect(document.activeElement).toBe(before);
  });
});

describe("telling two tiers apart", () => {
  /*
   * A site whose narrow tiers land in the same width class.
   *
   * The glyph comes from the bound, so both of these draw the same picture —
   * which is the case that decides whether a name is reachable before the
   * canvas has already changed.
   */
  const narrowTiers = (): BreakpointSet => ({
    viewport: [
      { id: "wide-phone", label: "Wide phone", maxWidth: 480 },
      { id: "phone", label: "Phone", maxWidth: 375 },
    ],
    container: [],
  });

  it("names every option, not only the selected one", () => {
    render(
      <BreakpointSwitcher
        breakpoints={narrowTiers()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    /*
     * Asserted on the two that COLLIDE rather than on the whole group, so the
     * unconditional option — which keeps its word on screen and would satisfy
     * a blanket assertion — cannot answer for them.
     */
    const titles = options()
      .map(option => option.getAttribute("title"))
      .filter((title): title is string => title !== null);

    expect(titles).toContain("Phone, up to 375 pixels");
    expect(titles).toContain("Wide phone, up to 480 pixels");
  });

  it("carries the width in the accessible name as well as the tooltip", () => {
    /*
     * A tooltip is a pointer affordance and reaches neither a screen reader nor
     * a keyboard. The two names are asserted separately because they are
     * separate mechanisms: dropping the accessible name leaves this control
     * usable with a mouse and unusable without one, and nothing about the
     * rendered output would look wrong.
     */
    render(
      <BreakpointSwitcher
        breakpoints={narrowTiers()}
        width={undefined}
        onSelect={vi.fn()}
        status="ready"
      />
    );

    expect(
      screen.getByRole("radio", { name: "Phone, up to 375 pixels" })
    ).toBeDefined();
    expect(
      screen.getByRole("radio", { name: "Wide phone, up to 480 pixels" })
    ).toBeDefined();
  });
});
