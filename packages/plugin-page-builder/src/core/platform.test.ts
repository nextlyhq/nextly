import { describe, expect, it } from "vitest";

import { createRevision, pruneRevisions } from "./revisions";
import { composeTemplate } from "./templates";
import { makeNode } from "./tree";
import type { BlockDocument } from "./types";

const doc = (text: string): BlockDocument => ({
  version: 1,
  root: makeNode("core/container", {}, undefined, {
    default: [makeNode("core/heading", { text })],
  }),
});

describe("composeTemplate", () => {
  it("wraps page content with header and footer parts", () => {
    const out = composeTemplate(doc("Body"), {
      header: doc("Header"),
      footer: doc("Footer"),
    });
    const kids = out.root.slots!.default!;
    expect(kids.length).toBe(3);
    // header first, page middle, footer last
    expect(JSON.stringify(kids[0])).toContain("Header");
    expect(JSON.stringify(kids[1])).toContain("Body");
    expect(JSON.stringify(kids[2])).toContain("Footer");
  });

  it("works with no parts (just the page)", () => {
    const out = composeTemplate(doc("Only"));
    expect(out.root.slots!.default!.length).toBe(1);
  });
});

describe("revisions", () => {
  it("creates an immutable snapshot", () => {
    const d = doc("v1");
    const rev = createRevision(d, "Autosave", "r1", "2026-07-14T00:00:00Z");
    expect(rev.id).toBe("r1");
    expect(rev.label).toBe("Autosave");
    // snapshot is a clone, not a reference
    expect(rev.tree).not.toBe(d);
    expect(JSON.stringify(rev.tree)).toContain("v1");
  });

  it("prunes to the newest `max` revisions", () => {
    const list = ["a", "b", "c", "d"].map(id =>
      createRevision(doc(id), id, id, "t")
    );
    const kept = pruneRevisions(list, 2);
    expect(kept.map(r => r.id)).toEqual(["c", "d"]);
    expect(pruneRevisions(list, 0)).toEqual([]);
  });
});
