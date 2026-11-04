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
  { keys: "mod+s", description: "Save", layer: "entry-form" },
  { keys: "Escape", description: "Cancel and go back", layer: "entry-form" },
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
      { description: "Save", keys: ["Ctrl+S"] },
    ]);
  });

  it("leaves out the admin's key sequences, and keeps a single key they begin with", () => {
    // "g d" is the admin's site navigation; Help inside the editor lists what
    // the editor does. A single "d" binding is a different keystroke.
    const rows = helpShortcuts(
      [
        { keys: "g d", description: "Go to the dashboard", layer: "nav" },
        { keys: "d", description: "Open or close Design", layer: "panels" },
      ],
      false
    );
    expect(rows).toEqual([
      { description: "Open or close Design", keys: ["D"] },
    ]);
  });

  it("spells the keys for the platform", () => {
    const rows = helpShortcuts(active, true);
    expect(rows.find(row => row.description === "Save")?.keys).toEqual(["⌘S"]);
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

describe("telling two spellings of one key apart", () => {
  const spelled = [
    { keys: "mod+k", description: "Open the command palette", layer: "a" },
    { keys: "ctrl+k", description: "Insert a link", layer: "b" },
  ];

  it("lists a key once when two layers spell it differently", () => {
    // Off Apple, mod+k IS Ctrl+K: the first binding takes it, and Help must
    // not claim Ctrl+K also inserts a link.
    expect(helpShortcuts(spelled, false).map(row => row.description)).toEqual([
      "Open the command palette",
    ]);
  });

  it("lists both where the spellings are different keys", () => {
    // On a Mac, mod+k is ⌘K and ctrl+k is Control-K: two keys, two rows.
    expect(helpShortcuts(spelled, true).map(row => row.description)).toEqual([
      "Open the command palette",
      "Insert a link",
    ]);
  });

  it("treats a letter's case and its modifier order as the same key", () => {
    const reordered = [
      { keys: "shift+mod+z", description: "Redo", layer: "a" },
      { keys: "Mod+Shift+Z", description: "Something else", layer: "b" },
    ];
    expect(helpShortcuts(reordered, false).map(row => row.description)).toEqual(
      ["Redo"]
    );
  });
});
