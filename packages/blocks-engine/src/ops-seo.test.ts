/**
 * The `seo` op: what a page or template states for its page as a whole
 * (`settings.seo`), written as one undoable edit.
 *
 * The properties a plausible implementation gets wrong: an undo that leaves
 * an empty `settings` or `seo` behind on a document that had none, an undo
 * that keeps the other settings' values from before rather than now, a
 * malformed value let into the document, a no-op recorded as an edit, and a
 * Layers lock refusing an edit that changes no block.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { applyOp, OpError } from "./ops";

function template(over: Partial<BlockDocument> = {}): BlockDocument {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "template",
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

const RULE = {
  title: [{ $bind: "title" }, " | Acme"],
  socialTitle: ["Read: ", { $bind: "title" }],
};

describe("the seo op", () => {
  it("writes a document's metadata where it had none, and its undo leaves nothing behind", () => {
    const before = template();
    const applied = applyOp(before, { kind: "seo", seo: RULE });
    expect(applied.document.settings?.seo).toEqual(RULE);
    expect(applied.inverse).toEqual({ kind: "seo", seo: null });

    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
    expect(Object.hasOwn(undone.document, "settings")).toBe(false);
  });

  it("replaces the metadata whole, keeps the other settings, and undoes to what it replaced", () => {
    const before = template({
      settings: { customCss: "a{}", seo: { title: ["Old"] } },
    });
    const applied = applyOp(before, { kind: "seo", seo: RULE });
    expect(applied.document.settings).toEqual({ customCss: "a{}", seo: RULE });

    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
  });

  it("removes the metadata, keeping the other settings", () => {
    const before = template({ settings: { customCss: "a{}", seo: RULE } });
    const applied = applyOp(before, { kind: "seo", seo: null });
    expect(applied.document.settings).toEqual({ customCss: "a{}" });
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("refuses metadata a save would refuse, and an edit that changes nothing", () => {
    expect(() =>
      applyOp(template(), {
        kind: "seo",
        seo: { title: "Not a list" } as never,
      })
    ).toThrow(OpError);
    expect(() =>
      applyOp(template({ settings: { seo: RULE } }), {
        kind: "seo",
        seo: JSON.parse(JSON.stringify(RULE)) as typeof RULE,
      })
    ).toThrow(/changes nothing/);
    expect(() => applyOp(template(), { kind: "seo", seo: null })).toThrow(
      /changes nothing/
    );
  });

  it("is not refused by a Layers lock, since it changes no block", () => {
    expect(
      applyOp(template(), { kind: "seo", seo: RULE }).document.settings?.seo
    ).toEqual(RULE);
  });
});
