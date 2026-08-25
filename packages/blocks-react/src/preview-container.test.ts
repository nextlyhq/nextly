/**
 * That the two properties a preview box needs cannot be separated.
 *
 * @module preview-container.test
 */
import { describe, expect, it } from "vitest";

import { PREVIEW_VIEWPORT_CONTAINER } from "@nextlyhq/blocks-engine";

import { PREVIEW_CONTAINER_STYLE } from "./preview-container";

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

  it("names the SAME container the compiler emits against", () => {
    // One source for the name. Spelled separately, the box and the sheet could
    // disagree, and the preview would match nothing with no error anywhere.
    expect(PREVIEW_CONTAINER_STYLE.containerName).toBe(
      PREVIEW_VIEWPORT_CONTAINER
    );
  });

  it("contains the INLINE axis only, not both", () => {
    // A preview box is sized by its content in the block direction; containing
    // that too would collapse the page's height to nothing.
    expect(PREVIEW_CONTAINER_STYLE.containerType).toBe("inline-size");
  });
});
