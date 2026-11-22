/**
 * The `code` op: the code a page adds to itself (`settings.code`), written
 * as one undoable edit, and its shape as a save judges it.
 *
 * The properties a plausible implementation gets wrong: an undo that leaves
 * an empty `settings` behind on a document that had none, an undo that keeps
 * the other settings' values from before rather than now, a malformed value
 * let into the document, a no-op recorded as an edit, and a Layers lock
 * refusing an edit that changes no block.
 */
import { describe, expect, it } from "vitest";

import { DOCUMENT_FORMAT_VERSION, type BlockDocument } from "./document";
import { applyOp, OpError } from "./ops";
import { validateDocument } from "./validation";

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

const CODE = {
  head: '<meta name="robots" content="noindex">',
  body: "<script>window.pageCodeTest = 1</script>",
};

describe("the code op", () => {
  it("writes a page's code where it had none, and its undo leaves nothing behind", () => {
    const before = page();
    const applied = applyOp(before, { kind: "code", code: CODE });
    expect(applied.document.settings?.code).toEqual(CODE);
    expect(applied.inverse).toEqual({ kind: "code", code: null });

    const undone = applyOp(applied.document, applied.inverse);
    expect(undone.document).toEqual(before);
    expect(Object.hasOwn(undone.document, "settings")).toBe(false);
  });

  it("replaces the code whole, keeps the other settings, and undoes to what it replaced", () => {
    const seo = { title: ["Pricing"] };
    const before = page({ settings: { seo, code: { head: "<!-- old -->" } } });
    const applied = applyOp(before, { kind: "code", code: CODE });
    expect(applied.document.settings).toEqual({ seo, code: CODE });
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("removes the code, keeping the other settings", () => {
    const before = page({ settings: { customCss: "a{}", code: CODE } });
    const applied = applyOp(before, { kind: "code", code: null });
    expect(applied.document.settings).toEqual({ customCss: "a{}" });
    expect(applyOp(applied.document, applied.inverse).document).toEqual(before);
  });

  it("refuses code a save would refuse, and an edit that changes nothing", () => {
    expect(() =>
      applyOp(page(), { kind: "code", code: { head: 1 } as never })
    ).toThrow(OpError);
    expect(() =>
      applyOp(page(), { kind: "code", code: { footer: "x" } as never })
    ).toThrow(/not a code field/);
    expect(() =>
      applyOp(page({ settings: { code: CODE } }), {
        kind: "code",
        code: { ...CODE },
      })
    ).toThrow(/changes nothing/);
  });

  it("is never refused by a Layers lock, since it changes no block", () => {
    // The page's only block is locked.
    expect(() => applyOp(page(), { kind: "code", code: CODE })).not.toThrow();
  });
});

describe("a page's code, as a save judges it", () => {
  it("accepts text in each place, and refuses anything else", () => {
    const issues = (code: unknown) =>
      validateDocument({ ...page(), settings: { code } } as never, {
        mode: "forgiving",
        breakpoints: { viewport: [], container: [] },
      }).issues.filter(issue => issue.path.startsWith("/settings/code"));
    expect(issues({ ...CODE, acknowledgedCsp: "abc" })).toEqual([]);
    expect(issues("<script>")).toMatchObject([
      { path: "/settings/code", code: "invalid-code" },
    ]);
    expect(issues({ head: 1 })).toMatchObject([
      { path: "/settings/code/head", code: "invalid-code" },
    ]);
    expect(issues({ css: "a{}" })).toMatchObject([
      { path: "/settings/code/css", code: "invalid-code" },
    ]);
  });
});
