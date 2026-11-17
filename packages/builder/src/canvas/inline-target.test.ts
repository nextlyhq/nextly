/**
 * Whether a block's values may be edited in place on the canvas.
 *
 * A Layers lock covers everything inside the block that holds it, so a block
 * inside a locked one is not editable in place either; the control is the
 * same block once nothing around it is locked.
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  clearBlocks,
  registerBlocks,
  type BlockDocument,
  type BlockNode,
} from "@nextlyhq/blocks-engine";

import { firstInlineProp, inlinePropsOfKind } from "./inline-target";

afterEach(clearBlocks);

function register(): void {
  registerBlocks(
    [
      {
        name: "acme/title",
        version: 1,
        description: "A title.",
        example: { props: {} },
        props: { text: { type: "text", inline: true } },
        render: () => null,
      },
    ] as never,
    { source: "inline-target-test" }
  );
}

/** A box, locked or not, holding one title. */
function page(locked: boolean): BlockDocument {
  return {
    formatVersion: 1,
    kind: "page",
    nodes: [
      {
        id: "box",
        type: "acme/title",
        version: 1,
        props: {},
        ...(locked ? { locked: true } : {}),
        slots: {
          children: [{ id: "t", type: "acme/title", version: 1, props: {} }],
        },
      } as BlockNode,
    ],
  } as BlockDocument;
}

describe("in-place editing under a Layers lock", () => {
  it("offers nothing on a block inside a locked one", () => {
    register();
    expect(firstInlineProp(page(true), "t")).toBeNull();
    expect(inlinePropsOfKind(page(true), "t", "plain")).toBeNull();
  });

  it("offers the block's text once nothing around it is locked", () => {
    register();
    expect(firstInlineProp(page(false), "t")).toEqual({
      prop: "text",
      kind: "plain",
    });
  });
});
