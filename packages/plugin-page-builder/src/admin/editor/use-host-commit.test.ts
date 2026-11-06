/**
 * Whether the open editor holds work the form cannot see.
 *
 * An inspector field holding a passage open in the shared rich-text editor is
 * such work, as an open passage on the canvas is: its words are in that
 * editor alone until it is finished, so Save must be offered for it.
 */
import { describe, expect, it } from "vitest";

import { hasUnsavedWork } from "./use-host-commit";

const clean = { editing: null, editingRich: null };

describe("hasUnsavedWork", () => {
  it("counts a passage open in an inspector field", () => {
    expect(
      hasUnsavedWork({ undoDepth: 0 }, { ...clean, inspecting: true })
    ).toBe(true);
  });

  it("is clean with nothing open and nothing since the save point", () => {
    // The control: the new term does not make every editor dirty.
    expect(
      hasUnsavedWork({ undoDepth: 0 }, { ...clean, inspecting: false })
    ).toBe(false);
    expect(hasUnsavedWork({ undoDepth: 0 }, clean)).toBe(false);
  });
});
