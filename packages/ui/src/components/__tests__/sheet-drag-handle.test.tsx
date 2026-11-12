// @vitest-environment jsdom
/**
 * A bottom sheet's grab strip: a drag down past a quarter of the sheet, or a
 * quick flick, closes it through the sheet's own `onOpenChange`; a shorter,
 * slower drag springs back; Escape still closes it; and only a bottom sheet
 * that asks for the strip draws one.
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
  dragCloses,
} from "../sheet";

afterEach(cleanup);

function renderSheet(
  props: { side?: "bottom" | "right"; dragHandle?: boolean } = {}
) {
  const onOpenChange = vi.fn();
  render(
    <Sheet open onOpenChange={onOpenChange}>
      <SheetContent
        side={props.side ?? "bottom"}
        dragHandle={props.dragHandle ?? true}
      >
        <SheetTitle>Document</SheetTitle>
        <SheetDescription>Details</SheetDescription>
      </SheetContent>
    </Sheet>
  );
  const sheet = screen.getByRole("dialog");
  // jsdom lays nothing out: give the sheet the height a phone would.
  sheet.getBoundingClientRect = () => ({ height: 400 }) as DOMRect;
  const handle = sheet.querySelector<HTMLElement>(
    "[data-slot='sheet-drag-handle']"
  );
  return { onOpenChange, sheet, handle };
}

/** A drag on the strip from y=100 to y=100+distance, over `elapsed` ms. */
function drag(handle: HTMLElement, distance: number, elapsed: number) {
  const now = vi.spyOn(performance, "now").mockReturnValue(1000);
  fireEvent.pointerDown(handle, { clientY: 100, pointerId: 1 });
  fireEvent.pointerMove(handle, { clientY: 100 + distance, pointerId: 1 });
  now.mockReturnValue(1000 + elapsed);
  fireEvent.pointerUp(handle, { clientY: 100 + distance, pointerId: 1 });
  now.mockRestore();
}

describe("a bottom sheet's grab strip", () => {
  it("is drawn on a bottom sheet that asks for it, hidden from assistive technology", () => {
    const { handle } = renderSheet();
    expect(handle).not.toBeNull();
    expect(handle?.getAttribute("aria-hidden")).toBe("true");
  });

  it("is not drawn on a side sheet, or on a bottom sheet that does not ask", () => {
    expect(renderSheet({ side: "right" }).handle).toBeNull();
    cleanup();
    expect(renderSheet({ dragHandle: false }).handle).toBeNull();
  });

  it("follows the pointer down, never up", () => {
    const { sheet, handle } = renderSheet();
    fireEvent.pointerDown(handle!, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle!, { clientY: 160, pointerId: 1 });
    expect(sheet.style.transform).toBe("translateY(60px)");
    fireEvent.pointerMove(handle!, { clientY: 40, pointerId: 1 });
    expect(sheet.style.transform).toBe("translateY(0px)");
  });

  it("closes the sheet when dragged past a quarter of its height", () => {
    const { onOpenChange, handle } = renderSheet();
    drag(handle!, 120, 1000);
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("springs back from a shorter, slower drag", () => {
    const { onOpenChange, sheet, handle } = renderSheet();
    drag(handle!, 80, 1000);
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("springs back when the drag is cancelled, however far it went", () => {
    const { onOpenChange, sheet, handle } = renderSheet();
    fireEvent.pointerDown(handle!, { clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(handle!, { clientY: 390, pointerId: 1 });
    fireEvent.pointerCancel(handle!, { clientY: 390, pointerId: 1 });
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(sheet.style.transform).toBe("");
  });

  it("still closes on Escape", () => {
    const { onOpenChange, sheet } = renderSheet();
    fireEvent.keyDown(sheet, { key: "Escape" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});

describe("when a release closes the sheet", () => {
  it("closes past a quarter of the height, at any speed", () => {
    expect(dragCloses(100, 5000, 400)).toBe(true);
    expect(dragCloses(99, 5000, 400)).toBe(false);
  });

  it("closes on a quick flick from a short drag, but never from a tap", () => {
    expect(dragCloses(40, 50, 400)).toBe(true);
    expect(dragCloses(10, 5, 400)).toBe(false);
  });
});
