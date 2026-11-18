/**
 * The `customCss` op: a document's own custom CSS (`settings.customCss`),
 * written as one undoable edit, as `code` writes its code.
 *
 * The properties a plausible implementation gets wrong: an undo that leaves
 * an empty `settings` behind on a document that had none, an undo that keeps
 * the other settings' values from before rather than now, a value that isn't
 * text let into the document, an empty text kept as CSS, a no-op recorded as
 * an edit, and a Layers lock refusing an edit that changes no block.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { addressesNoNode, applyOp, OpError } from "./ops";

function page(over: Partial<BlockDocument> = {}): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "h1",
        type: "core/heading",
        version: 1,
        props: { text: "Title" },
        locked: true,
      },
    ],
    ...over,
  } as BlockDocument;
}

const CSS = "h1 { color: rebeccapurple; }";

describe("the customCss op", () => {
  it("writes a document's CSS where it had none, and its undo leaves nothing behind", () => {
    const before = page();
    const applied = applyOp(before, { kind: "customCss", customCss: CSS });
    expect(applied.document.settings?.customCss).toBe(CSS);
    expect(applied.inverse).toEqual({ kind: "customCss", customCss: null });

    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
    expect(Object.hasOwn(undone.document, "settings")).toBe(false);
  });

  it("replaces the CSS, keeps the other settings, and undoes to what it replaced", () => {
    const code = { head: "<!-- page -->" };
    const before = page({ settings: { code, customCss: "p { margin: 0; }" } });
    const applied = applyOp(before, { kind: "customCss", customCss: CSS });
    expect(applied.document.settings).toEqual({ code, customCss: CSS });
    expect(applied.inverse).toEqual({
      kind: "customCss",
      customCss: "p { margin: 0; }",
    });
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("removes the CSS, keeping the other settings", () => {
    const code = { head: "<!-- page -->" };
    const before = page({ settings: { code, customCss: CSS } });
    const applied = applyOp(before, { kind: "customCss", customCss: null });
    expect(applied.document.settings).toEqual({ code });
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("refuses a value that isn't text, empty text, and an edit that changes nothing", () => {
    expect(() =>
      applyOp(page(), { kind: "customCss", customCss: { css: CSS } as never })
    ).toThrow(OpError);
    expect(() => applyOp(page(), { kind: "customCss", customCss: "" })).toThrow(
      /null to remove it/
    );
    expect(() =>
      applyOp(page({ settings: { customCss: CSS } }), {
        kind: "customCss",
        customCss: CSS,
      })
    ).toThrow(/changes nothing/);
  });

  it("is never refused by a Layers lock, and addresses no block", () => {
    // The page's only block is locked.
    expect(() =>
      applyOp(page(), { kind: "customCss", customCss: CSS })
    ).not.toThrow();
    expect(addressesNoNode({ kind: "customCss", customCss: CSS })).toBe(true);
  });
});
