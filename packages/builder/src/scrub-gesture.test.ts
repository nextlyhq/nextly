// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";

import { DEFAULT_ACTIVATION_PX } from "./canvas-drag";
import {
  FIELD_SCRUB_START,
  fieldScrubMove,
  fieldStep,
  followScrub,
  SCRUB_ACTIVATION_PX,
  scrubModifiersOf,
  type ScrubHandlers,
} from "./scrub-gesture";

const NONE = { shift: false, alt: false };
const SHIFT = { shift: true, alt: false };
const ALT = { shift: false, alt: true };

/** A pointer event jsdom can dispatch, carrying the fields the gesture reads. */
function pointer(
  type: string,
  init: { pointerId?: number; clientX?: number; clientY?: number } = {}
): Event {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, {
    pointerId: init.pointerId ?? 1,
    clientX: init.clientX ?? 0,
    clientY: init.clientY ?? 0,
  });
  return event;
}

function host(): HTMLElement {
  const element = document.createElement("label");
  document.body.append(element);
  // jsdom has no pointer capture; recorded so a test can see it taken.
  const captured = new Set<number>();
  Object.assign(element, {
    setPointerCapture: vi.fn((id: number) => captured.add(id)),
    hasPointerCapture: (id: number) => captured.has(id),
    releasePointerCapture: vi.fn((id: number) => captured.delete(id)),
  });
  return element;
}

function handlers() {
  return {
    onMove: vi.fn<ScrubHandlers["onMove"]>(),
    onRelease: vi.fn<ScrubHandlers["onRelease"]>(),
    onEscape: vi.fn<NonNullable<ScrubHandlers["onEscape"]>>(),
    onEnd: vi.fn<ScrubHandlers["onEnd"]>(),
  };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("the shared threshold", () => {
  /*
   * Identity, not equality. A second threshold spelled here would agree with
   * the canvas today and drift the moment either moves, leaving one editor
   * with two answers to "did the hand mean to move".
   */
  it("is the canvas's own figure, so the handles and the labels start a drag at one distance", () => {
    expect(SCRUB_ACTIVATION_PX).toBe(DEFAULT_ACTIVATION_PX);
  });
});

describe("followScrub", () => {
  it("treats travel inside the dead zone as a click: no move, no release, no capture", () => {
    const element = host();
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 100, clientY: 0, host: element }, on);

    document.dispatchEvent(pointer("pointermove", { clientX: 103 }));
    document.dispatchEvent(pointer("pointerup", { clientX: 103 }));

    expect(on.onMove).not.toHaveBeenCalled();
    expect(on.onRelease).not.toHaveBeenCalled();
    expect(element.setPointerCapture).not.toHaveBeenCalled();
    expect(on.onEnd).toHaveBeenCalledTimes(1);
  });

  it("starts the drag past the dead zone, captures the pointer then, and releases once", () => {
    const element = host();
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 100, clientY: 0, host: element }, on);

    document.dispatchEvent(
      pointer("pointermove", { clientX: 100 + SCRUB_ACTIVATION_PX })
    );
    expect(element.setPointerCapture).toHaveBeenCalledWith(1);
    expect(on.onMove).toHaveBeenLastCalledWith(expect.anything(), {
      dx: SCRUB_ACTIVATION_PX,
      dy: 0,
    });

    document.dispatchEvent(pointer("pointerup", { clientX: 130 }));
    expect(on.onRelease).toHaveBeenCalledTimes(1);
    expect(on.onRelease).toHaveBeenLastCalledWith(expect.anything(), {
      dx: 30,
      dy: 0,
    });
    expect(element.releasePointerCapture).toHaveBeenCalledWith(1);
    expect(on.onEnd).toHaveBeenCalledTimes(1);

    // Its listeners are gone: a later move or release reaches nobody.
    document.dispatchEvent(pointer("pointermove", { clientX: 200 }));
    document.dispatchEvent(pointer("pointerup", { clientX: 200 }));
    expect(on.onMove).toHaveBeenCalledTimes(1);
    expect(on.onRelease).toHaveBeenCalledTimes(1);
  });

  it("ignores another pointer's moves, release and cancel", () => {
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 0, clientY: 0, host: host() }, on);

    document.dispatchEvent(
      pointer("pointermove", { pointerId: 2, clientX: 50 })
    );
    document.dispatchEvent(pointer("pointercancel", { pointerId: 2 }));
    document.dispatchEvent(pointer("pointerup", { pointerId: 2 }));

    expect(on.onMove).not.toHaveBeenCalled();
    expect(on.onEnd).not.toHaveBeenCalled();
  });

  it("abandons the drag on Escape: no release, and the gesture ends", () => {
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 0, clientY: 0, host: host() }, on);
    document.dispatchEvent(pointer("pointermove", { clientX: 40 }));

    const heardBeyond = vi.fn();
    document.body.addEventListener("keydown", heardBeyond);
    const escape = new KeyboardEvent("keydown", {
      key: "Escape",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(escape);
    document.dispatchEvent(pointer("pointerup", { clientX: 40 }));

    expect(on.onEscape).toHaveBeenCalledTimes(1);
    expect(escape.defaultPrevented).toBe(true);
    // Nothing past the gesture hears it: the editor's own Escape would move
    // the selection out from under the drag.
    expect(heardBeyond).not.toHaveBeenCalled();
    expect(on.onRelease).not.toHaveBeenCalled();
    expect(on.onEnd).toHaveBeenCalledTimes(1);
  });

  it("keeps every other key from the page while the pointer is down, and lets the modifiers through", () => {
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 0, clientY: 0, host: host() }, on);
    document.dispatchEvent(pointer("pointermove", { clientX: 40 }));
    const heard = vi.fn();
    document.body.addEventListener("keydown", heard);

    const arrow = new KeyboardEvent("keydown", {
      key: "ArrowUp",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(arrow);
    expect(arrow.defaultPrevented).toBe(true);
    expect(heard).not.toHaveBeenCalled();

    const shift = new KeyboardEvent("keydown", {
      key: "Shift",
      bubbles: true,
      cancelable: true,
    });
    document.body.dispatchEvent(shift);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(on.onEnd).not.toHaveBeenCalled();
  });

  it("lets a Control or Meta chord through, so the editor's Undo still works mid-drag", () => {
    const on = handlers();
    followScrub({ pointerId: 1, clientX: 0, clientY: 0, host: host() }, on);
    document.dispatchEvent(pointer("pointermove", { clientX: 40 }));
    const heard = vi.fn();
    document.body.addEventListener("keydown", heard);

    for (const chord of [{ ctrlKey: true }, { metaKey: true }]) {
      const undo = new KeyboardEvent("keydown", {
        key: "z",
        bubbles: true,
        cancelable: true,
        ...chord,
      });
      document.body.dispatchEvent(undo);
      expect(undo.defaultPrevented).toBe(false);
    }
    expect(heard).toHaveBeenCalledTimes(2);
    expect(on.onEnd).not.toHaveBeenCalled();
  });

  it("ends without a release on a cancel, and end() is safe twice", () => {
    const on = handlers();
    const session = followScrub(
      { pointerId: 1, clientX: 0, clientY: 0, host: host() },
      on
    );
    document.dispatchEvent(pointer("pointermove", { clientX: 40 }));
    expect(session.active).toBe(true);

    document.dispatchEvent(pointer("pointercancel"));
    session.end();

    expect(on.onRelease).not.toHaveBeenCalled();
    expect(on.onEnd).toHaveBeenCalledTimes(1);
  });
});

describe("fieldStep, the inspector's reading of the modifiers", () => {
  it("steps by one, by ten with Shift, by a tenth with Alt, and Shift wins over Alt", () => {
    expect(fieldStep(NONE)).toBe(1);
    expect(fieldStep(SHIFT)).toBe(10);
    expect(fieldStep(ALT)).toBe(0.1);
    expect(fieldStep({ shift: true, alt: true })).toBe(10);
  });

  it("reads the modifiers off an event", () => {
    expect(scrubModifiersOf({ shiftKey: true, altKey: false })).toEqual(SHIFT);
  });
});

describe("fieldScrubMove", () => {
  it("moves the value one step per pixel of horizontal travel", () => {
    const moved = fieldScrubMove(FIELD_SCRUB_START, 12, NONE);
    expect(moved.delta).toBe(12);
    expect(fieldScrubMove(moved, 5, NONE).delta).toBe(5);
  });

  it("multiplies the travel by ten with Shift and by a tenth with Alt", () => {
    expect(fieldScrubMove(FIELD_SCRUB_START, 3, SHIFT).delta).toBe(30);
    expect(fieldScrubMove(FIELD_SCRUB_START, 3, ALT).delta).toBe(0.3);
    expect(fieldScrubMove(FIELD_SCRUB_START, -7, ALT).delta).toBe(-0.7);
  });

  it("applies a modifier pressed mid-drag to the rest of the drag only", () => {
    const plain = fieldScrubMove(FIELD_SCRUB_START, 5, NONE);
    // Five more pixels with Shift: 5 + 50, not (5 + 5) × 10.
    expect(fieldScrubMove(plain, 10, SHIFT).delta).toBe(55);
  });

  it("continues from the change on screen when Alt widens the precision", () => {
    // 4.6px of travel reads as 5; one more pixel with Alt is 5.1, never 4.7,
    // which would step back while the pointer moves on.
    const plain = fieldScrubMove(FIELD_SCRUB_START, 4.6, NONE);
    expect(plain.delta).toBe(5);
    expect(fieldScrubMove(plain, 5.6, ALT).delta).toBe(5.1);
  });

  it("keeps a fine step's tenth after Alt is let go", () => {
    const fine = fieldScrubMove(FIELD_SCRUB_START, 3, ALT);
    expect(fieldScrubMove(fine, 5, NONE).delta).toBe(2.3);
  });

  it("rounds a fractional pixel to the step, and never answers -0", () => {
    expect(fieldScrubMove(FIELD_SCRUB_START, 2.4, NONE).delta).toBe(2);
    expect(
      Object.is(fieldScrubMove(FIELD_SCRUB_START, -0.2, NONE).delta, 0)
    ).toBe(true);
  });
});
