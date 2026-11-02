/**
 * The shortcuts Help lists, from the registry that holds them.
 *
 * Each case is one way the list could describe a keystroke that does not do
 * what it says: a key several layers bind listed with a binding that does not
 * run, one action split across two lines, or a binding listed with a key this
 * platform cannot spell.
 */
import { describe, expect, it } from "vitest";

import { helpShortcuts } from "./help-shortcuts";

// In the manager's order, most precedent first: the editor's layers, then the
// page's around it.
const active = [
  {
    keys: "Delete",
    description: "Delete the selected block",
    layer: "builder-block-actions",
  },
  {
    keys: "Backspace",
    description: "Delete the selected block",
    layer: "builder-block-actions",
  },
  {
    keys: "mod+d",
    description: "Duplicate the selected block",
    layer: "builder-block-actions",
  },
  {
    keys: "Escape",
    description: "Clear the block selection",
    layer: "builder-canvas-escape",
  },
  { keys: "mod+s", description: "Save entry", layer: "entry-form" },
  { keys: "escape", description: "Cancel and go back", layer: "entry-form" },
];

describe("helpShortcuts", () => {
  it("lists one line per action, with every key that does it", () => {
    expect(helpShortcuts(active, false)).toEqual([
      {
        description: "Delete the selected block",
        keys: ["Delete", "Backspace"],
      },
      { description: "Duplicate the selected block", keys: ["Ctrl+D"] },
      { description: "Clear the block selection", keys: ["Escape"] },
      { description: "Save entry", keys: ["Ctrl+S"] },
    ]);
  });

  it("spells the keys for the platform", () => {
    const rows = helpShortcuts(active, true);
    expect(rows.find(row => row.description === "Save entry")?.keys).toEqual([
      "⌘S",
    ]);
  });

  it("lists a key several layers bind once, with the binding that takes it", () => {
    // Escape inside the editor clears the selection; the page's "Cancel and go
    // back" never runs there, so listing it would describe a key that does
    // something else. Spelled differently on purpose: the manager matches
    // keys without regard to case.
    const descriptions = helpShortcuts(active, false).map(
      row => row.description
    );
    expect(descriptions).toContain("Clear the block selection");
    expect(descriptions).not.toContain("Cancel and go back");
  });

  it("lets an undescribed binding take its key without listing it", () => {
    const rows = helpShortcuts(
      [
        { keys: "mod+k", description: "", layer: "editor" },
        {
          keys: "mod+k",
          description: "Open the command palette",
          layer: "page",
        },
      ],
      false
    );
    expect(rows).toEqual([]);
  });

  it("leaves out a key it cannot spell", () => {
    expect(
      helpShortcuts(
        [{ keys: "mod+", description: "Broken", layer: "x" }],
        false
      )
    ).toEqual([]);
  });
});
