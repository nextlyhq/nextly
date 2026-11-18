// @vitest-environment jsdom

/**
 * Copy style and Paste style against the real editor state: one undo step
 * for any number of targets, the blocks written and never a shared style,
 * the words for what a target skips, and the refusals a held block meets.
 *
 * @module style-clipboard-verbs.test
 */
import {
  DOCUMENT_FORMAT_VERSION,
  findNode,
  type AnyBlockDefinition,
  type BlockDocument,
  type BlockNode,
  type NamedClass,
  type NodeStyles,
} from "@nextlyhq/blocks-engine";
import { act, renderHook } from "@testing-library/react";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import { useEditorState } from "./editor-state";
import { NOTHING_COPIED_YET } from "./style-clipboard";
import { useStyleClipboardVerbs } from "./style-clipboard-verbs";
import { useStyleTarget, type SharedStylesHost } from "./style-target";

const eyebrow: NamedClass = {
  id: "t-eyebrow",
  slug: "eyebrow",
  label: "Eyebrow",
  orderIndex: 2,
  role: "text",
  styles: { base: { base: { fontSize: "12px" } } } as NodeStyles,
};
const display: NamedClass = {
  id: "t-display",
  slug: "display",
  label: "Display",
  orderIndex: 1,
  role: "text",
  styles: { base: { base: { fontSize: "64px" } } } as NodeStyles,
};
const card: NamedClass = {
  id: "c-card",
  slug: "card",
  label: "Card",
  orderIndex: 0,
  styles: { base: { base: { color: "blue" } } } as NodeStyles,
};
const LIBRARY = [eyebrow, display, card];

const DEFINITIONS: Record<string, AnyBlockDefinition> = {
  "acme/heading": {
    name: "acme/heading",
    label: "Heading",
    supports: { typography: true, color: true },
  } as unknown as AnyBlockDefinition,
  "acme/image": {
    name: "acme/image",
    label: "Image",
    supports: { spacing: true },
  } as unknown as AnyBlockDefinition,
};
const definitions = (type: string): AnyBlockDefinition | undefined =>
  DEFINITIONS[type];

const SOURCE_STYLES = {
  base: {
    base: { color: "red", fontSize: "32px" },
    mobile: { fontSize: "20px" },
  },
  hover: { base: { color: "darkred" } },
} as unknown as NodeStyles;

function block(
  id: string,
  type: string,
  extra: Partial<BlockNode> = {}
): BlockNode {
  return { id, type, version: 1, props: { text: `words of ${id}` }, ...extra };
}

const page = (...nodes: BlockNode[]): BlockDocument => ({
  formatVersion: DOCUMENT_FORMAT_VERSION,
  kind: "page",
  nodes,
});

/** A source heading and two targets, one wearing "Display". */
const THREE = page(
  block("src", "acme/heading", {
    styles: SOURCE_STYLES,
    classes: [eyebrow.id, card.id],
  }),
  block("a", "acme/heading", { classes: [display.id] }),
  block("b", "acme/heading", {
    styles: { base: { base: { color: "green" } } } as unknown as NodeStyles,
  })
);

/** The editor, its style clipboard, and the editing bar's target. */
function setUp(initialDocument: BlockDocument, host?: SharedStylesHost) {
  const announce = vi.fn<(message: string) => void>();
  const notify = vi.fn<(message: string) => void>();
  const { result } = renderHook(() => {
    const editor = useEditorState({ initialDocument });
    const latest = React.useRef(editor);
    latest.current = editor;
    const verbs = useStyleClipboardVerbs({
      latest,
      announce,
      notify,
      library: LIBRARY,
      definitions,
    });
    const bar = useStyleTarget(editor, LIBRARY, host);
    return { editor, verbs, bar };
  });
  return { result, announce, notify };
}

/** Select `ids` the way clicks do. */
function selectAll(
  editor: ReturnType<typeof useEditorState>,
  ids: readonly string[]
): void {
  const [first, ...rest] = ids;
  if (first !== undefined) editor.select(first, "replace");
  for (const id of rest) editor.select(id, "toggle");
}

describe("Copy style and Paste style", () => {
  it("gives every selected block the source's look as one undo step, and leaves their words", () => {
    const { result, announce } = setUp(THREE);
    act(() => result.current.editor.select("src"));
    act(() => {
      expect(result.current.verbs.copyStyle()).toBe(true);
    });
    // Copying changes nothing on the page.
    expect(result.current.editor.undoDepth).toBe(0);
    expect(announce).toHaveBeenLastCalledWith("Style copied from Heading.");

    act(() => selectAll(result.current.editor, ["a", "b"]));
    act(() => result.current.verbs.pasteStyle());
    const doc = result.current.editor.document;
    for (const id of ["a", "b"]) {
      const target = findNode(doc.nodes, id);
      expect(target?.styles).toEqual(SOURCE_STYLES);
      // "Display" gives way to the source's "Eyebrow".
      expect(target?.classes).toEqual([eyebrow.id, card.id]);
      expect(target?.props).toEqual({ text: `words of ${id}` });
    }
    expect(result.current.editor.undoDepth).toBe(1);
    expect(announce).toHaveBeenLastCalledWith(
      "Style pasted on 2 blocks. Undo with Control or Command Z."
    );

    act(() => {
      void result.current.editor.undo();
    });
    expect(result.current.editor.document.nodes).toEqual(THREE.nodes);
  });

  it("clears a target's text style when the source wears none", () => {
    const { result } = setUp(
      page(
        block("src", "acme/heading"),
        block("a", "acme/heading", { classes: [display.id] })
      )
    );
    act(() => result.current.editor.select("src"));
    act(() => {
      result.current.verbs.copyStyle();
    });
    act(() => result.current.editor.select("a"));
    act(() => result.current.verbs.pasteStyle());
    expect(
      findNode(result.current.editor.document.nodes, "a")
    ).not.toHaveProperty("classes");
  });

  it("writes the blocks, never the shared style the editing bar targets", () => {
    const writeStyles = vi.fn<SharedStylesHost["writeStyles"]>(() =>
      Promise.resolve(undefined)
    );
    const host: SharedStylesHost = { mayChange: true, writeStyles };
    const { result } = setUp(
      page(
        block("src", "acme/heading", { styles: SOURCE_STYLES }),
        block("a", "acme/heading", { classes: [card.id] })
      ),
      host
    );
    act(() => result.current.editor.select("src"));
    act(() => {
      result.current.verbs.copyStyle();
    });
    act(() => result.current.editor.select("a"));
    // The bar edits the block's shared style "Card".
    act(() => result.current.bar.choose(card.id));
    expect(result.current.bar.target.kind).toBe("shared");

    act(() => result.current.verbs.pasteStyle());
    expect(writeStyles).not.toHaveBeenCalled();
    const target = findNode(result.current.editor.document.nodes, "a");
    expect(target?.styles).toEqual(SOURCE_STYLES);
    // The source wears no shared style, so the target wears none either.
    expect(target).not.toHaveProperty("classes");
    expect(result.current.editor.undoDepth).toBe(1);
  });

  it("skips what a target can't take and says how many settings, in plain words", () => {
    const { result, notify, announce } = setUp(
      page(
        block("src", "acme/heading", {
          styles: SOURCE_STYLES,
          classes: [eyebrow.id],
        }),
        block("img", "acme/image")
      )
    );
    act(() => result.current.editor.select("src"));
    act(() => {
      result.current.verbs.copyStyle();
    });
    act(() => result.current.editor.select("img"));
    act(() => result.current.verbs.pasteStyle());
    // Colour, size on two devices, hover colour and the text style.
    expect(notify).toHaveBeenCalledWith("5 settings don't apply to Image.");
    expect(announce).toHaveBeenLastCalledWith(
      "5 settings don't apply to Image."
    );
    const image = findNode(result.current.editor.document.nodes, "img");
    expect(image).not.toHaveProperty("styles");
    expect(image).not.toHaveProperty("classes");
  });

  it("says to copy a style first when none has been copied", () => {
    const { result, notify } = setUp(THREE);
    act(() => result.current.editor.select("a"));
    act(() => result.current.verbs.pasteStyle());
    expect(notify).toHaveBeenCalledWith(NOTHING_COPIED_YET);
    expect(result.current.editor.undoDepth).toBe(0);
  });

  it("copies from one block only", () => {
    const { result } = setUp(THREE);
    act(() => selectAll(result.current.editor, ["a", "b"]));
    act(() => {
      expect(result.current.verbs.copyStyle()).toBe(false);
    });
  });

  it("refuses the whole paste when a target's design is locked, and changes nothing", () => {
    const { result, notify } = setUp(
      page(
        block("src", "acme/heading", { styles: SOURCE_STYLES }),
        block("a", "acme/heading"),
        block("held", "acme/heading", { locked: true } as Partial<BlockNode>)
      )
    );
    act(() => result.current.editor.select("src"));
    act(() => {
      result.current.verbs.copyStyle();
    });
    act(() => selectAll(result.current.editor, ["a", "held"]));
    act(() => result.current.verbs.pasteStyle());
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatch(/lock/i);
    expect(result.current.editor.undoDepth).toBe(0);
  });

  it("says so when the blocks already look like the source", () => {
    const { result, announce } = setUp(
      page(
        block("src", "acme/heading", { styles: SOURCE_STYLES }),
        block("a", "acme/heading", { styles: SOURCE_STYLES })
      )
    );
    act(() => result.current.editor.select("src"));
    act(() => {
      result.current.verbs.copyStyle();
    });
    act(() => result.current.editor.select("a"));
    act(() => result.current.verbs.pasteStyle());
    expect(announce).toHaveBeenLastCalledWith(
      "This block already has this style."
    );
    expect(result.current.editor.undoDepth).toBe(0);
  });
});
