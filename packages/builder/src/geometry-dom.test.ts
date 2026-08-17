// @vitest-environment jsdom

/**
 * The one DOM read in the frame mapping, and the one it kept getting wrong.
 *
 * `geometry.test.ts` covers the arithmetic, which takes plain numbers and needs
 * no browser. What is only true HERE is which measurements add up to the inset —
 * and the answer is the whole reason this module exists: the contract was once
 * documented as `clientLeft`/`clientTop`, three call sites followed that recipe,
 * and all three were short by the padding.
 *
 * So padding is the separating property throughout. A border-only fixture is
 * satisfied by exactly the implementation this function was written to replace,
 * which is why no case below leaves padding at zero without saying so.
 *
 * @module geometry-dom.test
 */
import { afterEach, describe, expect, it } from "vitest";

import { frameInsetOf } from "./geometry-dom";

/**
 * A frame with known border and padding.
 *
 * `clientLeft`/`clientTop` are defined rather than styled: jsdom performs no
 * layout, so a border declared in CSS leaves both reading 0 and every assertion
 * would pass on an implementation that ignored borders entirely. Defining them
 * is what makes the border observable at all here.
 */
function frameWith({
  border,
  padding,
}: {
  border: { left: number; top: number };
  padding?: string;
}): HTMLIFrameElement {
  const frame = document.createElement("iframe");
  if (padding !== undefined) frame.style.padding = padding;
  document.body.appendChild(frame);
  Object.defineProperty(frame, "clientLeft", { value: border.left });
  Object.defineProperty(frame, "clientTop", { value: border.top });
  return frame;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("frameInsetOf", () => {
  it("adds the padding to the border", () => {
    // THE case. An implementation reading `clientLeft`/`clientTop` alone
    // answers {left: 3, top: 5} here — which is the defect this module was
    // introduced to remove, and it is invisible in any zero-padding fixture.
    const frame = frameWith({
      border: { left: 3, top: 5 },
      padding: "7px 0 0 11px",
    });

    expect(frameInsetOf(frame)).toEqual({ left: 14, top: 12 });
  });

  it("reports the border alone when there is no padding", () => {
    // The control for the case above: it pins the border as still being read,
    // so a function that returned only padding would fail here rather than
    // passing both.
    const frame = frameWith({ border: { left: 4, top: 6 }, padding: "0px" });

    expect(frameInsetOf(frame)).toEqual({ left: 4, top: 6 });
  });

  it("reports the padding alone when there is no border", () => {
    // The mirror control. Together the three fix both coefficients at 1, which
    // neither a border-only nor a padding-only reader satisfies.
    const frame = frameWith({ border: { left: 0, top: 0 }, padding: "9px" });

    expect(frameInsetOf(frame)).toEqual({ left: 9, top: 9 });
  });

  it("keeps the border when a frame is detached and has no computed style", () => {
    // A frame outside a document has no view, so padding cannot be resolved.
    // The border is still readable, and reporting it beats guessing a padding
    // that would displace every mapped point — but the value must be a NUMBER:
    // an unparsed `NaN` propagates silently through the mapping and surfaces
    // later as coordinates that were never meaningful.
    const frame = document.createElement("iframe");
    Object.defineProperty(frame, "clientLeft", { value: 2 });
    Object.defineProperty(frame, "clientTop", { value: 3 });

    const inset = frameInsetOf(frame);

    expect(Number.isFinite(inset.left)).toBe(true);
    expect(Number.isFinite(inset.top)).toBe(true);
    expect(inset).toEqual({ left: 2, top: 3 });
  });

  it("never answers NaN, whatever the padding parses to", () => {
    // `parseFloat` on a value it cannot read returns NaN, and NaN survives
    // addition — so a single unreadable padding would poison the inset and
    // every point mapped through it, with no error anywhere.
    const frame = frameWith({ border: { left: 1, top: 1 } });
    frame.style.paddingLeft = "auto";
    frame.style.paddingTop = "auto";

    const inset = frameInsetOf(frame);

    expect(Number.isFinite(inset.left)).toBe(true);
    expect(Number.isFinite(inset.top)).toBe(true);
  });
});
