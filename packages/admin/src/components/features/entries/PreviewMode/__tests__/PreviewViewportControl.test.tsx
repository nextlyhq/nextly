/**
 * The viewport control, asserted on what an author can actually do with it.
 *
 * The case that matters is the half-typed one. A width box is a field people
 * clear and retype rather than edit in place, so the states it passes through
 * on the way to a number are the states it spends most of its life in — and a
 * control that only behaves while holding a valid width is a control that
 * misbehaves exactly while it is being used.
 */
import { act, fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { UI } from "@admin/constants/ui";
import type { PreviewViewport } from "@admin/services/previewLinkApi";

import type { PreviewFit } from "@admin/components/shared/preview/previewFrameFit";
import { PreviewViewportControl } from "../PreviewViewportControl";

/**
 * Rendered with the parent's real state loop, not a spy.
 *
 * The defect this file exists for is a REMOUNT caused by the parent's answer
 * coming back and changing what renders. A mocked `onRequestWidth` that records
 * calls without feeding the value back cannot reproduce it — the control would
 * pass while the shipped tree still unmounted the field.
 */
function renderControl(
  initial: number | null = 1280,
  viewports: readonly PreviewViewport[] = []
) {
  function Harness() {
    const [requestedWidth, setRequestedWidth] = useState<number | null>(
      initial
    );
    const fit: PreviewFit =
      requestedWidth === null
        ? { kind: "responsive" }
        : { kind: "exact", width: requestedWidth };
    return (
      <>
        <PreviewViewportControl
          requestedWidth={requestedWidth}
          onRequestWidth={setRequestedWidth}
          fit={fit}
          viewports={viewports}
        />
        <output data-testid="committed">{String(requestedWidth)}</output>
      </>
    );
  }
  render(<Harness />);
  return {
    box: () => screen.queryByLabelText("Preview width in pixels"),
    committed: () => screen.getByTestId("committed").textContent,
  };
}

/**
 * The pause that ends an edit.
 *
 * A width is committed when the author stops typing, so a test that asserts
 * what was committed has to say when that happened. Written out rather than
 * hidden in a helper called `flush`, because the delay is the behaviour.
 */
function stopTyping() {
  act(() => {
    vi.advanceTimersByTime(UI.PREVIEW_WIDTH_DEBOUNCE_MS);
  });
}

describe("PreviewViewportControl — choosing a viewport", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Opens the list and picks the option with this exact visible text. */
  function choose(name: string | RegExp) {
    fireEvent.click(screen.getByLabelText("Preview viewport"));
    fireEvent.click(screen.getByRole("option", { name }));
  }

  it("keeps Custom reachable when its seed matches a declared viewport", () => {
    /*
     * Entering custom mode commits a seed width. If the site happens to declare
     * a viewport at that width — 1280 is the seed and a very ordinary desktop
     * tier — the named lookup resolved it on the next render, flipped the
     * selection to that preset's name and never rendered the input. The author
     * could then not enter a custom width at all.
     *
     * Choosing Custom is a statement the width alone cannot carry, so it opens
     * an edit rather than relying on the number being unrecognised.
     */
    renderControl(null, [{ label: "Desktop", width: 1280 }]);

    choose("Custom width");

    expect(
      screen.getByLabelText("Preview width in pixels")
    ).toBeInTheDocument();
  });

  it("STAYS in custom mode after typing a width a viewport also declares", () => {
    /*
     * The deliberate consequence of recording the choice. Having asked for a
     * custom width, an author who then types one that happens to equal a
     * declared tier keeps the box: they said "custom", and resolving the number
     * against the list would take the control away from them on the strength of
     * a coincidence. Picking an option from the list is how they leave.
     */
    renderControl(null, [{ label: "Tablet", width: 768 }]);

    choose("Custom width");
    const box = screen.getByLabelText(
      "Preview width in pixels"
    ) as HTMLInputElement;

    fireEvent.change(box, { target: { value: "768" } });
    fireEvent.blur(box);

    expect(
      screen.getByLabelText("Preview width in pixels")
    ).toBeInTheDocument();

    // ...and choosing the named option is what hands it back.
    choose(/Tablet/);
    expect(screen.queryByLabelText("Preview width in pixels")).toBeNull();
  });

  it("commits a named viewport at its EXACT declared width", () => {
    /*
     * Declared widths are no longer rounded on the server, so a site can offer
     * `767.6` — and `parseInt` on the option's value committed `767`. The frame
     * then sat one side of the site's own `@media (max-width: 767.6px)`
     * boundary while the control displayed the tier it was not in.
     */
    const ui = renderControl(null, [{ label: "Tablet", width: 767.6 }]);

    choose(/Tablet/);

    expect(ui.committed()).toBe("767.6");
  });

  it("shows a named viewport as selected once it is committed", () => {
    /*
     * The control on the case above: committing the exact width is only right
     * if the lookup then RECOGNISES it. Truncated to 767 it matched nothing and
     * the control fell back to Custom, which is how the rounding disagreement
     * would have been visible had anyone looked.
     */
    renderControl(null, [{ label: "Tablet", width: 767.6 }]);

    choose(/Tablet/);

    expect(screen.queryByLabelText("Preview width in pixels")).toBeNull();
    expect(screen.getByLabelText("Preview viewport")).toHaveTextContent(
      /Tablet/
    );
  });
});

describe("PreviewViewportControl — the width box", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("KEEPS the box mounted and focused when it is cleared", () => {
    /*
     * The separating property. Clearing to retype used to commit `null`, which
     * selected Responsive, which removed this field — so React unmounted the
     * element the author was typing into and every keystroke after the first
     * went nowhere. Focus is asserted because a remount that restored an
     * identically-shaped field would still lose the caret.
     */
    const ui = renderControl(1280);
    const box = ui.box();
    expect(box).not.toBeNull();

    box?.focus();
    fireEvent.change(box as HTMLElement, { target: { value: "" } });

    expect(ui.box()).not.toBeNull();
    expect(document.activeElement).toBe(box);
  });

  it("shows the author's own text while it is being typed", () => {
    // The box has to read back what was typed into it. Showing the committed
    // width instead would fight the author for the field's contents.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "" } });
    // Still the field that is IN the document: a detached node keeps whatever
    // value was written to it, so reading `box.value` alone would pass against
    // an implementation that had already unmounted this input.
    expect(ui.box()).toBe(box);
    expect(box.value).toBe("");

    fireEvent.change(box, { target: { value: "76" } });
    expect(ui.box()).toBe(box);
    expect(box.value).toBe("76");
  });

  it("holds the last good width while the box says nothing usable", () => {
    /*
     * The frame is sized to the committed value, so committing a half-typed
     * number would make the preview flicker between widths on the way to one
     * the author meant. It stays where it was until the box names a width.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");
  });

  it("commits a width as soon as the box names one", () => {
    // The control still has to work: this is what stops the case above from
    // being satisfied by a box that commits nothing at all.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "768" } });
    stopTyping();
    expect(ui.committed()).toBe("768");
  });

  it("does not commit the PREFIXES typed on the way to a width", () => {
    /*
     * `768` arrives as `7`, then `76`, then `768`. Committing each one sized
     * the frame to 7px and then 76px — a live iframe of the whole site, laid
     * out twice at widths the author never asked for, which is the resize
     * thrash the draft state was supposed to remove.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "7" } });
    fireEvent.change(box, { target: { value: "76" } });
    fireEvent.change(box, { target: { value: "768" } });

    // Still the width it started at: nothing has been committed yet.
    expect(ui.committed()).toBe("1280");

    stopTyping();
    expect(ui.committed()).toBe("768");
  });

  it("takes the pending width when the edit ends at the BOX", () => {
    /*
     * Blur answers the question the pause was waiting on, so waiting it out
     * afterwards would discard the width — an author who types one and clicks
     * straight into the page means it.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "390" } });
    fireEvent.blur(box);

    expect(ui.committed()).toBe("390");
  });

  it("refuses a width below one pixel", () => {
    /*
     * `min={1}` on a number input marks the field invalid; it does not clamp
     * the value or stop the change event. Below a pixel the preview is not
     * narrow, it is gone — an empty pane rather than a small one.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "0.5" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");

    fireEvent.change(box, { target: { value: "1e-3" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");
  });

  it("accepts exactly one pixel, which is the boundary", () => {
    // The control on the case above: refusing below a pixel must not refuse the
    // pixel itself, or the stated minimum would be unreachable.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "1" } });
    stopTyping();
    expect(ui.committed()).toBe("1");
  });

  it("does not commit a zero or negative width", () => {
    // `previewFrameFit` reads both as "no request" and fills the pane, so
    // committing one would put the control and the frame in different states.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "0" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");

    fireEvent.change(box, { target: { value: "-5" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");
  });

  it("commits the WHOLE number the box shows, not its integer prefix", () => {
    /*
     * `parseInt` stops at the first character that cannot continue an integer,
     * so it reads `390.5` as `390` and `1e3` as `1` — both of which a number
     * input accepts and displays in full. The frame was then sized to a width
     * the box was not showing, and blurring replaced the author's text with the
     * truncated value as though they had typed it.
     *
     * A fractional width is a real width: CSS sizes to it and the site's media
     * queries resolve against it, so there is nothing to reject here.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "390.5" } });
    stopTyping();
    expect(ui.committed()).toBe("390.5");

    fireEvent.change(box, { target: { value: "1e3" } });
    stopTyping();
    expect(ui.committed()).toBe("1000");
  });

  it("reports a fractional width as VALID to the browser", () => {
    /*
     * A number input steps by 1 unless told otherwise, so a committed `390.5`
     * raised `stepMismatch`: native validation and assistive technology both
     * called the field invalid while the preview was using that exact width.
     * Asserted through `validity` rather than by reading the `step` attribute,
     * because the attribute is the mechanism and this is the consequence.
     */
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "390.5" } });
    stopTyping();

    expect(ui.committed()).toBe("390.5");
    expect(box.validity.stepMismatch).toBe(false);
    expect(box.checkValidity()).toBe(true);
  });

  it("still refuses text that names no width at all", () => {
    // The control on the case above: reading the whole value must not turn
    // every string into a width. `Number("")` is `0` and `Number("abc")` is
    // `NaN`, and both mean the box is not saying anything a frame can be at.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "abc" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");

    fireEvent.change(box, { target: { value: "" } });
    stopTyping();
    expect(ui.committed()).toBe("1280");
  });

  it("stays mounted while typing PAST a width a named viewport also has", () => {
    /*
     * The same unmount, reached by a different door, and only reachable once the
     * control offers named viewports. The box is shown when the committed width
     * matches no named one — so typing `7680` passes through `768`, which IS a
     * named tier, and the field would vanish on the third keystroke.
     *
     * An edit in progress therefore keeps the box regardless of what the number
     * currently matches. Selection follows the same rule, or the dropdown would
     * flip to "Tablet" while the author is still typing into a box labelled
     * Custom.
     */
    const ui = renderControl(1280, [{ label: "Tablet", width: 768 }]);
    const box = ui.box() as HTMLInputElement;
    box.focus();

    fireEvent.change(box, { target: { value: "768" } });
    /*
     * The pause is what makes this the real case rather than a formality. It
     * COMMITS 768 — which is a named tier — so the match is live while the
     * author is still in the box. Without the pause nothing is committed at
     * all and the assertion below would hold whatever the rule was.
     */
    stopTyping();
    expect(ui.committed()).toBe("768");

    expect(ui.box()).toBe(box);
    expect(document.activeElement).toBe(box);

    fireEvent.change(box, { target: { value: "7680" } });
    stopTyping();

    expect(ui.box()).toBe(box);
    expect(ui.committed()).toBe("7680");
  });

  it("hands a typed width back to its named viewport once the edit ends", () => {
    /*
     * The control on the case above. Keeping the box open during an edit must
     * not mean the control never recognises a named width — on blur the draft
     * clears, `768` resolves to Tablet, and the box gives way to the named
     * option it is the same width as.
     */
    const ui = renderControl(1280, [{ label: "Tablet", width: 768 }]);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "768" } });
    fireEvent.blur(box);

    expect(ui.box()).toBeNull();
    expect(ui.committed()).toBe("768");
  });

  it("snaps back to the committed width when the edit is abandoned", () => {
    // Blur ends the edit. A draft left behind would name a width the frame is
    // not at, which is the control disagreeing with itself.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "" } });
    fireEvent.blur(box);

    expect(box.value).toBe("1280");
  });
});
