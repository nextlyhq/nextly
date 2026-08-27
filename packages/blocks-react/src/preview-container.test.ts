/**
 * That the two properties a preview box needs cannot be separated, and that
 * both bind to the name the compile was actually given.
 *
 * @module preview-container.test
 */
import { describe, expect, it } from "vitest";

import { PREVIEW_VIEWPORT_CONTAINER } from "@nextlyhq/blocks-engine";

import {
  PREVIEW_CONTAINER_STYLE,
  previewContainerStyle,
} from "./preview-container";

describe("the preview box style", () => {
  it("carries the container TYPE as well as the name", () => {
    /*
     * Either alone does nothing, and the failure is silent. A named container
     * left at the default `container-type: normal` is not a size-query
     * container, so every `(max-width: ...)` rule the preview compile emitted
     * stays inactive: the sheet is valid, the name matches, and resizing the box
     * changes nothing.
     *
     * Asserted as the whole object rather than field by field, so a property
     * removed later fails here rather than going unnoticed until a preview
     * silently stops responding.
     */
    expect(PREVIEW_CONTAINER_STYLE).toEqual({
      containerName: PREVIEW_VIEWPORT_CONTAINER,
      containerType: "inline-size",
    });
  });

  it("contains the INLINE axis only, not both", () => {
    // A preview box is sized by its content in the block direction; containing
    // that too would collapse the page's height to nothing.
    expect(PREVIEW_CONTAINER_STYLE.containerType).toBe("inline-size");
  });

  it("binds to the name the COMPILE was given, not the default", () => {
    /*
     * The compile option accepts any usable identifier. Pinned to the constant,
     * a surface previewing under its own name would declare one container while
     * the sheet queried another — both valid, and every responsive rule inactive
     * with nothing on screen to indicate why.
     */
    expect(previewContainerStyle("canvas-a")).toEqual({
      containerName: "canvas-a",
      containerType: "inline-size",
    });
  });

  it("establishes NO container when the compiler refused the name", () => {
    /*
     * The symmetry is the property, not a nicety. A refused name makes the
     * compile PUBLISHED — viewport tiers emit `@media` and container tiers emit
     * unnamed `@container` rules. A box that established a query container
     * anyway would let those unnamed rules resolve against IT, so viewport tiers
     * would follow the window while container tiers followed the canvas: a
     * hybrid neither mode intends, and exactly the capture a valid preview is
     * named to prevent.
     *
     * Asserted as an empty object, so a caller spreading it onto a style adds
     * nothing at all.
     */
    for (const refused of ["", "   ", "has space", "none", "initial"]) {
      expect(previewContainerStyle(refused)).toEqual({});
    }
  });

  it("establishes one for a name the compiler ACCEPTS, which is the control", () => {
    /*
     * The control. Without it, a helper returning `{}` for every input would
     * satisfy the refusal case above while making previewing impossible — the
     * assertion there is satisfied by absence, so its meaning depends on this.
     */
    expect(previewContainerStyle(PREVIEW_VIEWPORT_CONTAINER)).toEqual({
      containerName: PREVIEW_VIEWPORT_CONTAINER,
      containerType: "inline-size",
    });
    expect(PREVIEW_CONTAINER_STYLE).toEqual({
      containerName: PREVIEW_VIEWPORT_CONTAINER,
      containerType: "inline-size",
    });
  });
});
