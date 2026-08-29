// @vitest-environment jsdom

/**
 * The control's wiring, which is the half `canvas-zoom` cannot see.
 *
 * That module decides what a zoom IS and how it steps. What is only true here
 * is that the number on screen is the one the canvas is painting at — including
 * while fitting, which is the state that caused the confusion — and that
 * choosing a step reports the choice rather than applying it locally.
 *
 * @module canvas-zoom-control.test
 */
import { PortalProvider } from "@nextlyhq/ui";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CanvasZoomControl } from "./canvas-zoom-control";
import { FIT_ZOOM } from "./canvas-zoom";

afterEach(cleanup);

function mount(props: Partial<React.ComponentProps<typeof CanvasZoomControl>>) {
  const onChange = vi.fn();
  render(
    <PortalProvider container={window.document.body}>
      <CanvasZoomControl
        zoom={FIT_ZOOM}
        appliedScale={1}
        onChange={onChange}
        {...props}
      />
    </PortalProvider>
  );
  return { onChange };
}

describe("the canvas zoom control", () => {
  it("names the scale the canvas is PAINTING at while fitting", () => {
    /*
     * The state the whole control exists for. A canvas fitting into the region
     * the panels leave was measured falling from 89% to 59.5% when a panel
     * opened, with nothing on screen naming either — so a control that showed
     * only a scale the author had SET would be blank exactly when it matters.
     */
    mount({ zoom: FIT_ZOOM, appliedScale: 0.595 });

    expect(screen.getByRole("button").textContent).toBe("60%");
  });

  it("says whether that number will move on its own", () => {
    /*
     * "60%" alone does not say whether it is about to change when a panel
     * opens, and that is the entire difference between the two states. The
     * accessible name carries the mode; the visible text stays the number.
     */
    mount({ zoom: FIT_ZOOM, appliedScale: 0.6 });
    expect(screen.getByRole("button").getAttribute("aria-label")).toContain(
      "fitting"
    );

    cleanup();
    mount({ zoom: { kind: "fixed", scale: 0.6 }, appliedScale: 0.6 });
    expect(screen.getByRole("button").getAttribute("aria-label")).not.toContain(
      "fitting"
    );
  });

  it("renders nothing where nothing can act on a choice", () => {
    /*
     * The canvas belongs to the host, so a shell whose host has not wired this
     * has nowhere to apply a choice. Rendered anyway it stores a preference,
     * reports a percentage the canvas does not honour, and goes on reading
     * 100% whatever was picked — a control that looks operable and is not,
     * which is worse than its absence.
     */
    render(
      <PortalProvider container={window.document.body}>
        <CanvasZoomControl zoom={FIT_ZOOM} appliedScale={1} />
      </PortalProvider>
    );

    expect(screen.queryByRole("button")).toBeNull();
  });

  it("reports a chosen step rather than applying it itself", () => {
    /*
     * The canvas is the host's to render, so the control cannot scale anything
     * — it can only say what was asked for. A control that held its own scale
     * would be a second answer to how large the page is drawn.
     */
    const { onChange } = mount({ appliedScale: 1 });

    fireEvent.pointerDown(screen.getByRole("button"), { pointerType: "mouse" });
    const item = screen.getByRole("menuitemradio", { name: "150%" });
    fireEvent.pointerUp(item, { pointerType: "mouse" });

    expect(onChange).toHaveBeenCalledWith({ kind: "fixed", scale: 1.5 });
  });

  it("offers a way back to fitting", () => {
    /*
     * Without it a fixed scale is a one-way door: an author who chose 200% can
     * step back through the list but never return to the size that follows the
     * region, which is the editor's own default.
     */
    const { onChange } = mount({ zoom: { kind: "fixed", scale: 2 } });

    fireEvent.pointerDown(screen.getByRole("button"), { pointerType: "mouse" });
    fireEvent.pointerUp(screen.getByRole("menuitemradio", { name: "Fit" }), {
      pointerType: "mouse",
    });

    expect(onChange).toHaveBeenCalledWith(FIT_ZOOM);
  });
});

describe("which zoom the open menu says is current", () => {
  /** Open the menu and return the item with this label. */
  function itemNamed(name: string): HTMLElement {
    return screen.getByRole("menuitemradio", { name });
  }

  function open(): void {
    fireEvent.pointerDown(screen.getByRole("button"), { pointerType: "mouse" });
  }

  it("marks FIT rather than the step it happens to resolve to", () => {
    /*
     * The case the trigger cannot cover. Fit produces exactly 100% at the
     * widest tier, which is the state the editor opens in, so the visible
     * label is the same four characters for a canvas that will resize when a
     * panel opens and one that will not. Both items are asserted: marking Fit
     * while also marking 100% would satisfy an assertion on Fit alone, and it
     * is precisely the ambiguity being removed.
     */
    mount({ zoom: FIT_ZOOM, appliedScale: 1 });
    open();

    expect(itemNamed("Fit").getAttribute("aria-checked")).toBe("true");
    expect(itemNamed("100%").getAttribute("aria-checked")).toBe("false");
  });

  it("marks the STEP when one was chosen, at the same painted scale", () => {
    // The other half of the pair, deliberately at the scale that makes the two
    // states indistinguishable on the trigger.
    mount({ zoom: { kind: "fixed", scale: 1 }, appliedScale: 1 });
    open();

    expect(itemNamed("100%").getAttribute("aria-checked")).toBe("true");
    expect(itemNamed("Fit").getAttribute("aria-checked")).toBe("false");
  });

  it("marks NOTHING for a fixed scale the menu does not offer", () => {
    /*
     * A host can build a zoom directly and a stored value can outlive the step
     * list, so a scale between the steps is reachable. Marking the nearest one
     * would tell the author they chose something they did not; an unmarked
     * menu says truthfully that none of these is what is on screen.
     */
    mount({ zoom: { kind: "fixed", scale: 1.23 }, appliedScale: 1.23 });
    open();

    const marked = screen
      .getAllByRole("menuitemradio")
      .filter(item => item.getAttribute("aria-checked") === "true");
    // Asserted through the count of MARKED items rather than by naming each
    // one: a case that checks only the steps it thought of passes against an
    // implementation that marks a step it did not.
    expect(marked).toHaveLength(0);
    expect(screen.getAllByRole("menuitemradio").length).toBeGreaterThan(1);
  });
});
