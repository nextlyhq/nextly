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

import { paddingRespondsOutward } from "./padding-response";

function block(css?: string): HTMLElement {
  const element = document.createElement("div");
  if (css !== undefined) element.setAttribute("style", css);
  document.body.append(element);
  return element;
}

describe("the probe leaves the element as it found it", () => {
  it("removes an inline padding it added", () => {
    const element = block();
    paddingRespondsOutward(element, "bottom");
    expect(element.getAttribute("style")).toBeNull();
  });

  it("restores an inline value the author set", () => {
    const element = block("padding-bottom: 7px;");
    paddingRespondsOutward(element, "bottom");
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
    paddingRespondsOutward(element, "bottom");
    expect(element.style.getPropertyValue("padding-bottom")).toBe("7px");
    expect(element.style.getPropertyPriority("padding-bottom")).toBe(
      "important"
    );
  });

  it("leaves the other sides alone", () => {
    const element = block("padding-top: 3px; padding-left: 5px;");
    paddingRespondsOutward(element, "bottom");
    expect(element.style.getPropertyValue("padding-top")).toBe("3px");
    expect(element.style.getPropertyValue("padding-left")).toBe("5px");
  });

  it("restores every side it is asked about", () => {
    for (const side of ["top", "right", "bottom", "left"] as const) {
      const element = block();
      paddingRespondsOutward(element, side);
      expect(element.getAttribute("style"), side).toBeNull();
    }
  });
});
