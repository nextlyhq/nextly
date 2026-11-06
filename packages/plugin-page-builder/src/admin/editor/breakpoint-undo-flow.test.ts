/**
 * What Settings says while undoing a breakpoint removal, sentence by
 * sentence: each document an undo could not put back is named the way the
 * person can act on it, with why, the count first.
 *
 * @module admin/editor/breakpoint-undo-flow.test
 */
import { describe, expect, it } from "vitest";

import type { SiteBreakpointUndoSkipped } from "../../library-contract";

import {
  skippedLine,
  undoConfirmWords,
  undoneWords,
  undoRefusedWords,
} from "./breakpoint-undo-flow";

const PAGE = { kind: "collection", slug: "pages", id: "p1" } as const;

const skipped = (
  extra: Partial<SiteBreakpointUndoSkipped>
): SiteBreakpointUndoSkipped => ({
  ...PAGE,
  name: "Pricing",
  values: 2,
  reason: "changed",
  ...extra,
});

describe("skippedLine", () => {
  it("links a page that still exists, by its name, with why", () => {
    expect(skippedLine(skipped({}), ["Mobile"])).toEqual({
      name: "Pricing",
      href: "/admin/collections/pages/p1",
      why: "2 values set again for Mobile after the removal",
    });
  });

  it("names a deleted page in plain words, never linked", () => {
    const { name: _named, ...unnamed } = skipped({ reason: "gone", values: 1 });
    expect(skippedLine(unnamed, ["Mobile"])).toEqual({
      name: "A deleted page",
      why: "1 value was on this page, deleted after the removal",
    });
  });

  it("says each other reason in one pattern, the count first", () => {
    const why = (reason: SiteBreakpointUndoSkipped["reason"]) =>
      skippedLine(skipped({ reason }), ["Mobile"]).why;
    expect(why("block-deleted")).toBe(
      "2 values were on a block deleted after the removal"
    );
    expect(why("draft-gone")).toBe(
      "2 values were in a draft published or discarded after the removal"
    );
    expect(why("unreadable")).toBe(
      "2 values couldn't be checked: it can't be read"
    );
  });

  it("calls the shared styles by what they are, unlinked", () => {
    expect(
      skippedLine(
        {
          kind: "single",
          slug: "site-style",
          values: 1,
          reason: "block-deleted",
        },
        ["Mobile"]
      )
    ).toEqual({
      name: "Shared styles",
      why: "1 value was on a shared style deleted after the removal",
    });
  });

  it("names a page the person may not open without linking it", () => {
    const { name: _named, ...unnamed } = skipped({});
    expect(skippedLine(unnamed, ["Mobile"]).name).toBe("A page you can't open");
    expect(skippedLine(unnamed, ["Mobile"]).href).toBeUndefined();
  });
});

describe("undoneWords", () => {
  it("says it is all back when nothing stayed out", () => {
    expect(undoneWords(["Mobile"], [])).toMatchObject({
      title: "Mobile is back, with its styles",
      lines: [],
    });
  });

  it("names the total that stayed out, and lists each document", () => {
    const words = undoneWords(
      ["Mobile"],
      [skipped({}), skipped({ id: "p2", values: 3, reason: "gone" })]
    );
    expect(words.title).toBe(
      "Mobile is back, except 5 values that changed after the removal"
    );
    expect(words.lines).toHaveLength(2);
  });
});

describe("the undo's confirmation and refusal", () => {
  it("asks to put the breakpoint back, primary, not as a removal", () => {
    expect(undoConfirmWords(["Mobile"])).toMatchObject({
      title: "Put Mobile back?",
      confirm: "Put Mobile back",
    });
  });

  it("says the server's reason, and that nothing changed", () => {
    expect(
      undoRefusedWords(
        ["Mobile"],
        "This removal can't be undone: it was undone already."
      )
    ).toEqual({
      title: "Mobile can't be put back",
      body: "This removal can't be undone: it was undone already. Nothing was changed.",
    });
  });
});
