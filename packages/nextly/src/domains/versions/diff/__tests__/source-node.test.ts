/**
 * Guards the source (json / code) comparison.
 *
 * The headline is the pair of opposite mistakes. A reordered JSON key must NOT
 * report as a change — canonicalising is what makes the comparison about
 * content rather than about key order. A changed VALUE must report, on its own
 * line rather than as two whole blobs the reader diffs by eye.
 *
 * And a value that cannot be represented at all must refuse rather than report
 * equality, because "I could not read this" and "these are the same" lead a
 * reader deciding whether to restore in opposite directions.
 */
import { describe, expect, it } from "vitest";

import { sourceNode } from "../source-node";

const jsonMeta = { name: "meta", label: "Meta", type: "json" };
const codeMeta = { name: "snippet", label: "Snippet", type: "code" };

describe("sourceNode — json", () => {
  it("IDEMPOTENCE: a reordered key is not a change", () => {
    const node = sourceNode(jsonMeta, { a: 1, b: 2 }, { b: 2, a: 1 }, "json");
    expect(node.status).toBe("unchanged");
  });

  it("IDEMPOTENCE: a reordered key nested deeper is not a change either", () => {
    const node = sourceNode(
      jsonMeta,
      { outer: { a: 1, b: 2 } },
      { outer: { b: 2, a: 1 } },
      "json"
    );
    expect(node.status).toBe("unchanged");
  });

  it("MUST DIFFER: a changed value, on its own line", () => {
    const node = sourceNode(jsonMeta, { a: 1, b: 2 }, { a: 1, b: 3 }, "json");
    expect(node.status).toBe("changed");
    expect(node.lines.filter(l => l.status !== "unchanged")).toHaveLength(1);
  });

  it("MUST DIFFER: array order, which is content rather than key order", () => {
    // Sorting keys must not turn into sorting arrays: [1,2] and [2,1] are
    // different values, and an author who reorders a list changed something.
    const node = sourceNode(jsonMeta, { xs: [1, 2] }, { xs: [2, 1] }, "json");
    expect(node.status).toBe("changed");
  });

  it("reports an added key as an added line", () => {
    const node = sourceNode(jsonMeta, { a: 1 }, { a: 1, c: 9 }, "json");
    expect(node.lines.some(l => l.status === "added")).toBe(true);
  });

  it("distinguishes a stored null from an absent value", () => {
    // A json field can hold the primitive null as a real value, so the two
    // must not collapse into one another.
    expect(sourceNode(jsonMeta, null, { a: 1 }, "json").status).toBe("added");
    expect(sourceNode(jsonMeta, { a: 1 }, null, "json").status).toBe("removed");
  });

  it("carries the language so the renderer knows what to highlight", () => {
    expect(sourceNode(jsonMeta, { a: 1 }, { a: 2 }, "json").language).toBe(
      "json"
    );
  });
});

describe("sourceNode — code", () => {
  it("MUST DIFFER: one changed line among several", () => {
    const node = sourceNode(
      codeMeta,
      "const a = 1;\nconst b = 2;\nconst c = 3;",
      "const a = 1;\nconst b = 9;\nconst c = 3;",
      "code"
    );
    expect(node.language).toBe("code");
    expect(node.lines.filter(l => l.status !== "unchanged")).toHaveLength(1);
    expect(node.lines).toHaveLength(3);
  });

  it("carries word-level runs within a changed line", () => {
    const node = sourceNode(codeMeta, "let x = 1;", "let y = 1;", "code");
    const inserted = (node.lines[0]?.segments ?? []).filter(s => s.op === 1);
    expect(inserted.map(s => s.text).join("")).toContain("y");
  });

  it("numbers lines on the side each exists on", () => {
    const node = sourceNode(codeMeta, "a\nb", "a\nx\nb", "code");
    const added = node.lines.find(l => l.status === "added");
    expect(added?.toLine).toBe(1);
    const last = node.lines[node.lines.length - 1];
    expect(last).toMatchObject({ status: "unchanged", fromLine: 1, toLine: 2 });
  });

  it("IDEMPOTENCE: identical code reports unchanged", () => {
    const src = "const a = 1;\nconst b = 2;";
    expect(sourceNode(codeMeta, src, src, "code").status).toBe("unchanged");
  });
});

describe("sourceNode — what it cannot represent", () => {
  it("refuses rather than reporting equality when a value will not serialise", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const node = sourceNode(jsonMeta, cyclic, { a: 1 }, "json");
    expect(node.lines).toEqual([{ status: "unsupported" }]);
    expect(node.status).toBe("changed");
  });

  it("refuses when a code field holds something that is not a string", () => {
    // Nothing can be claimed about a value the projection cannot express, and
    // "unchanged" is the one answer that must not be given.
    const node = sourceNode(codeMeta, { not: "code" }, "real code", "code");
    expect(node.lines).toEqual([{ status: "unsupported" }]);
    expect(node.status).not.toBe("unchanged");
  });
});
