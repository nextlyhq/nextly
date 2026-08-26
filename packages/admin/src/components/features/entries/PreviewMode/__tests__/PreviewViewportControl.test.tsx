/**
 * The viewport control, asserted on what an author can actually do with it.
 *
 * The case that matters is the half-typed one. A width box is a field people
 * clear and retype rather than edit in place, so the states it passes through
 * on the way to a number are the states it spends most of its life in — and a
 * control that only behaves while holding a valid width is a control that
 * misbehaves exactly while it is being used.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { useState } from "react";
import { describe, expect, it } from "vitest";

import type { PreviewFit } from "../previewFrameFit";
import { PreviewViewportControl } from "../PreviewViewportControl";

/**
 * Rendered with the parent's real state loop, not a spy.
 *
 * The defect this file exists for is a REMOUNT caused by the parent's answer
 * coming back and changing what renders. A mocked `onRequestWidth` that records
 * calls without feeding the value back cannot reproduce it — the control would
 * pass while the shipped tree still unmounted the field.
 */
function renderControl(initial: number | null = 1280) {
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

describe("PreviewViewportControl — the width box", () => {
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
    expect(ui.committed()).toBe("1280");
  });

  it("commits a width as soon as the box names one", () => {
    // The control still has to work: this is what stops the case above from
    // being satisfied by a box that commits nothing at all.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "768" } });
    expect(ui.committed()).toBe("768");
  });

  it("does not commit a zero or negative width", () => {
    // `previewFrameFit` reads both as "no request" and fills the pane, so
    // committing one would put the control and the frame in different states.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "0" } });
    expect(ui.committed()).toBe("1280");

    fireEvent.change(box, { target: { value: "-5" } });
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
    expect(ui.committed()).toBe("390.5");

    fireEvent.change(box, { target: { value: "1e3" } });
    expect(ui.committed()).toBe("1000");
  });

  it("still refuses text that names no width at all", () => {
    // The control on the case above: reading the whole value must not turn
    // every string into a width. `Number("")` is `0` and `Number("abc")` is
    // `NaN`, and both mean the box is not saying anything a frame can be at.
    const ui = renderControl(1280);
    const box = ui.box() as HTMLInputElement;

    fireEvent.change(box, { target: { value: "abc" } });
    expect(ui.committed()).toBe("1280");

    fireEvent.change(box, { target: { value: "" } });
    expect(ui.committed()).toBe("1280");
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
