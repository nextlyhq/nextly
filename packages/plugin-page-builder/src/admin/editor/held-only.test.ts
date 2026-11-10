/**
 * The canvas's visitor-unreadable marks, kept to the blocks the editor holds:
 * a template's Entry content draws the entry's blocks, composed in for the
 * canvas, and none of those may be marked, since they are edited on the
 * entry. With nothing composed, the marks are handed back untouched and the
 * held document is not walked at all.
 */
import type { BlockDocument } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { heldOnly } from "./use-render-inputs";

const held: BlockDocument = {
  formatVersion: 1,
  kind: "template",
  nodes: [
    { id: "h", type: "core/heading", version: 1, props: {} },
    {
      id: "ec",
      type: "core/entry-content",
      version: 1,
      props: { field: "body" },
    },
  ],
};

/** The same template as drawn, with one of the entry's blocks composed in. */
const drawn: BlockDocument = {
  ...held,
  nodes: held.nodes.map(node =>
    node.id === "ec"
      ? {
          ...node,
          slots: {
            content: [{ id: "cx-1", type: "core/text", version: 1, props: {} }],
          },
        }
      : node
  ),
};

describe("the canvas's marks, kept to the blocks the editor holds", () => {
  it("drops a mark on a block composed in, and keeps one on the template's own", () => {
    const marks = new Map([
      ["h", "heading"],
      ["cx-1", "entry's text"],
    ]);
    expect([...heldOnly(held, drawn, marks).keys()]).toEqual(["h"]);
  });

  it("hands the marks back untouched, walking nothing, where nothing was composed (the control)", () => {
    const marks = new Map([["h", "heading"]]);
    // A held document whose blocks cannot be read: the identity path must
    // not walk them.
    const unwalkable = {
      ...held,
      get nodes(): never {
        throw new Error("walked");
      },
    } as unknown as BlockDocument;
    expect(heldOnly(unwalkable, unwalkable, marks)).toBe(marks);
  });
});
