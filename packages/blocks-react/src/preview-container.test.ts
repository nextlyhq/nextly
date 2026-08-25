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

  it("falls back to the default for a name the compiler would refuse", () => {
    /*
     * Normalised through the compiler's own rule, so a refusal here matches a
     * refusal there: the sheet compiles published, and a box declaring the
     * default container for queries nobody emitted is at worst inert. Declaring
     * the refused name instead would be a container nothing can ever query.
     *
     * The reserved keywords are included because they match an identifier's
     * SHAPE and are still excluded from a custom identifier — a validator
     * checking only the pattern would let them through here.
     */
    for (const refused of ["", "   ", "has space", "none", "initial"]) {
      expect(previewContainerStyle(refused).containerName).toBe(
        PREVIEW_VIEWPORT_CONTAINER
      );
    }
    expect(previewContainerStyle().containerName).toBe(
      PREVIEW_VIEWPORT_CONTAINER
    );
  });
});
