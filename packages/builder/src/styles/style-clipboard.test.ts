/**
 * What "Copy style" takes from a block, and the words a paste says about the
 * settings a target had no place for.
 *
 * @module style-clipboard.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

import { copiedStyleOf, skippedSettingsWords } from "./style-clipboard";

const LABELS: Record<string, string> = {
  "acme/image": "Image",
  "acme/button": "Button",
};
const lookup = (type: string): AnyBlockDefinition | undefined =>
  LABELS[type] === undefined
    ? undefined
    : ({ name: type, label: LABELS[type] } as unknown as AnyBlockDefinition);

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

describe("what Copy style takes", () => {
  it("takes the block's own values and the classes it wears, and nothing else", () => {
    const styles = {
      base: { base: { color: "red" }, mobile: { fontSize: "20px" } },
      hover: { base: { color: "darkred" } },
    } as unknown as NodeStyles;
    const document = page({
      id: "h",
      type: "core/heading",
      version: 1,
      props: { text: "Hello" },
      styles,
      classes: ["look", "text", "shared"],
    });
    const copied = copiedStyleOf(document, "h");
    expect(copied).toEqual({
      styles,
      classes: ["look", "text", "shared"],
    });
    // A copy, so a later edit of the block doesn't change what is pasted.
    expect(copied?.styles).not.toBe(styles);
  });

  it("takes a block with no style of its own as no style", () => {
    const document = page({
      id: "h",
      type: "core/heading",
      version: 1,
      props: {},
    });
    expect(copiedStyleOf(document, "h")).toEqual({
      styles: undefined,
      classes: [],
    });
  });

  it("takes nothing from a block that is not on the page", () => {
    expect(copiedStyleOf(page(), "gone")).toBeNull();
  });
});

describe("the words for skipped settings", () => {
  it("counts them in plain words, by the block's name", () => {
    expect(
      skippedSettingsWords(
        [{ nodeId: "i", type: "acme/image", count: 3 }],
        lookup
      )
    ).toBe("3 settings don't apply to Image.");
  });

  it("says one setting in the singular", () => {
    expect(
      skippedSettingsWords(
        [{ nodeId: "i", type: "acme/image", count: 1 }],
        lookup
      )
    ).toBe("1 setting doesn't apply to Image.");
  });

  it("names each kind of block once, however many of it were selected", () => {
    expect(
      skippedSettingsWords(
        [
          { nodeId: "i1", type: "acme/image", count: 3 },
          { nodeId: "b", type: "acme/button", count: 2 },
          { nodeId: "i2", type: "acme/image", count: 3 },
        ],
        lookup
      )
    ).toBe(
      "3 settings don't apply to Image. 2 settings don't apply to Button."
    );
  });

  it("says nothing when nothing was skipped", () => {
    expect(skippedSettingsWords([], lookup)).toBeUndefined();
  });
});
