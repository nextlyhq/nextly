// @vitest-environment jsdom

/**
 * What the probe must leave behind: nothing.
 *
 * WHICH edge responds is a layout question and jsdom has no layout, so the
 * answer itself is verified in a browser — measured there on an auto-height
 * block (border edge moves out) and a fixed-height one (content edge moves in).
 * What IS checkable here is the property that makes the probe safe to run
 * against a node the canvas is rendering: it writes to that element, and it must
 * restore it exactly, or it is an edit nobody made.
 *
 * @module padding-response.test
 */

import { describe, expect, it } from "vitest";

import { spacingRespondsOutward } from "./spacing-response";

function block(css?: string): HTMLElement {
  const element = document.createElement("div");
  if (css !== undefined) element.setAttribute("style", css);
  document.body.append(element);
  return element;
}

describe("the threshold is judged in the units the probe is SEEN in", () => {
  /*
   * `boxAcross` answers in viewport pixels and the canvas is painted through a
   * transform, so ten CSS pixels of padding move the edge by ten times the
   * scale on screen — five at half zoom, two and a half at quarter. A threshold
   * fixed in viewport pixels therefore reads an ordinary outward-growing block
   * as stationary on any zoomed canvas, puts the handle on the edge that never
   * moves and inverts the drag: the very defect this module exists to remove,
   * reintroduced by the units it was measured in.
   *
   * jsdom lays nothing out, so the movement is supplied directly: the rects are
   * stubbed to grow by exactly what the probe would produce at each scale.
   */
  function respondsAt(scale: number, grewBy: number): boolean {
    const element = block();
    let call = 0;
    element.getBoundingClientRect = () => {
      call += 1;
      // The second read is taken with the probe applied.
      const bottom = call === 1 ? 100 : 100 + grewBy;
      return { top: 0, bottom, left: 0, right: 100 } as DOMRect;
    };
    return spacingRespondsOutward(element, "padding", "bottom", scale);
  }

  it("sees an outward response at full zoom", () => {
    expect(respondsAt(1, 10)).toBe(true);
  });

  it("still sees it at half zoom, where the edge moves only five pixels", () => {
    expect(respondsAt(0.5, 5)).toBe(true);
  });

  it("still sees it at quarter zoom", () => {
    expect(respondsAt(0.25, 2.5)).toBe(true);
  });

  /*
   * The control. A block whose border edge does not move must read as inward at
   * every zoom — otherwise a threshold small enough to catch the quarter-zoom
   * case would call everything outward, which is the same defect mirrored.
   */
  it("reads no movement as inward at every zoom", () => {
    for (const scale of [1, 0.5, 0.25]) {
      expect(respondsAt(scale, 0), String(scale)).toBe(false);
    }
  });

  it("survives a scale it cannot use", () => {
    // Neither zero nor a broken number may make every block answer the same way.
    expect(respondsAt(0, 10)).toBe(true);
    expect(respondsAt(Number.NaN, 10)).toBe(true);
  });
});

describe("the two boxes read the same probe in opposite directions", () => {
  /*
   * The border edge is the FAR edge of a padding band and the NEAR edge of a
   * margin one, so a border edge that moved outward means a padding thickened
   * away from the block and a margin thickened toward it.
   *
   * Measured in Chromium, and this is what made the old table wrong on both
   * counts: `margin-top` in normal flow and in a flex column moves the block's
   * border edge DOWN while its outer edge stays pinned by whatever precedes it,
   * and `margin-bottom` does the opposite.
   */
  function respondsWith(box: "margin" | "padding", grewBy: number): boolean {
    const element = block();
    let call = 0;
    element.getBoundingClientRect = () => {
      call += 1;
      const bottom = call === 1 ? 100 : 100 + grewBy;
      return { top: 0, bottom, left: 0, right: 100 } as DOMRect;
    };
    return spacingRespondsOutward(element, box, "bottom", 1);
  }

  it("reads a moving border edge as a padding growing outward", () => {
    expect(respondsWith("padding", 10)).toBe(true);
    expect(respondsWith("padding", 0)).toBe(false);
  });

  it("reads the same movement as a margin growing INWARD", () => {
    expect(respondsWith("margin", 10)).toBe(false);
    expect(respondsWith("margin", 0)).toBe(true);
  });
});

describe("the probe leaves the element as it found it", () => {
  it("removes an inline padding it added", () => {
    const element = block();
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.getAttribute("style")).toBeNull();
  });

  it("restores an inline value the author set", () => {
    const element = block("padding-bottom: 7px;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-bottom")).toBe("7px");
    expect(element.style.getPropertyPriority("padding-bottom")).toBe("");
  });

  /*
   * Priority included. The probe writes `!important` so an author's own
   * important padding cannot win and make every block answer the same way — so
   * restoring the value while dropping its priority would quietly promote the
   * author's declaration over whatever it used to lose to.
   */
  it("restores the author's priority too", () => {
    const element = block("padding-bottom: 7px !important;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-bottom")).toBe("7px");
    expect(element.style.getPropertyPriority("padding-bottom")).toBe(
      "important"
    );
  });

  it("leaves the other sides alone", () => {
    const element = block("padding-top: 3px; padding-left: 5px;");
    spacingRespondsOutward(element, "padding", "bottom", 1);
    expect(element.style.getPropertyValue("padding-top")).toBe("3px");
    expect(element.style.getPropertyValue("padding-left")).toBe("5px");
  });

  it("restores every side it is asked about", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const element = block();
      spacingRespondsOutward(element, "padding", side, 1);
      expect(element.getAttribute("style"), side).toBeNull();
    }
  });
});
