import { describe, it, expect } from "vitest";

import { classifyLabelTarget } from "./label-landing";

/**
 * Build a real element so the classifier is exercised against the DOM's own
 * `tagName` casing and `HTMLInputElement.type` defaulting, rather than against
 * an object shaped like what the test author expected those to be.
 */
function element(html: string): Element {
  const host = document.createElement("div");
  host.innerHTML = html;
  const child = host.firstElementChild;
  if (child === null) throw new Error(`no element parsed from: ${html}`);
  return child;
}

describe("classifyLabelTarget", () => {
  it("reports an absent target when nothing carries the id", () => {
    expect(classifyLabelTarget(null)).toBe("absent");
  });

  // One case per labelable element, because the set is the HTML standard's and
  // a missing member reads as a defect in the caller's markup rather than as a
  // gap here — the check would tell a developer to fix correct markup.
  it.each([
    ["<button></button>", "BUTTON"],
    ["<input />", "INPUT"],
    ["<meter></meter>", "METER"],
    ["<output></output>", "OUTPUT"],
    ["<progress></progress>", "PROGRESS"],
    ["<select></select>", "SELECT"],
    ["<textarea></textarea>", "TEXTAREA"],
  ])("accepts %s as labelable", html => {
    expect(classifyLabelTarget(element(html))).toBe("labelable");
  });

  it("rejects a wrapper div, which is the shape FormControl produces", () => {
    // `FormControl` is a Radix `Slot`: it clones its id onto its single child.
    // Where that child is a positioning wrapper, the id lands here and a
    // presence-only check reports the field as correctly wired.
    const wrapper = element('<div class="relative"><input /></div>');
    expect(classifyLabelTarget(wrapper)).toBe("not-labelable");
    // The positive control on the same fixture: the element the label SHOULD
    // have reached is labelable, so the verdict above is about where the id
    // landed and not about the classifier refusing everything.
    expect(classifyLabelTarget(wrapper.firstElementChild)).toBe("labelable");
  });

  it("rejects a contenteditable surface, which cannot be named by a label", () => {
    expect(
      classifyLabelTarget(element('<div contenteditable="true"></div>'))
    ).toBe("not-labelable");
  });

  it("rejects an anchor, which is focusable but not labelable", () => {
    expect(classifyLabelTarget(element('<a href="#"></a>'))).toBe(
      "not-labelable"
    );
  });

  it("rejects a hidden input, which has nothing to name", () => {
    expect(classifyLabelTarget(element('<input type="hidden" />'))).toBe(
      "not-labelable"
    );
    // Positive control: the same tag with a real type is accepted, so the
    // rejection above comes from the `type` and not from INPUT being excluded.
    expect(classifyLabelTarget(element('<input type="text" />'))).toBe(
      "labelable"
    );
  });
});
