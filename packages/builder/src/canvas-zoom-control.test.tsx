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
    const item = screen.getByRole("menuitem", { name: "150%" });
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
    fireEvent.pointerUp(screen.getByRole("menuitem", { name: "Fit" }), {
      pointerType: "mouse",
    });

    expect(onChange).toHaveBeenCalledWith(FIT_ZOOM);
  });
});
