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

import { sourceNode, type SourceSide } from "../source-node";

const jsonMeta = { name: "meta", label: "Meta", type: "json" };
const codeMeta = { name: "snippet", label: "Snippet", type: "code" };

/** A side that held this value. */
const at = (value: unknown): SourceSide => ({ present: true, value });
/** A side the document did not have at all. */
const missing: SourceSide = { present: false };

/** A stored value in bcrypt's format, which the display must never print. */
const hash = (fill: string) => `$2b$10$${fill.repeat(53)}`;

/** Every character any of a node's lines would put on screen. */
const printed = (node: { lines: { segments?: { text: string }[] }[] }) =>
  node.lines
    .flatMap(l => l.segments ?? [])
    .map(s => s.text)
    .join("");

describe("sourceNode — json", () => {
  it("IDEMPOTENCE: a reordered key is not a change", () => {
    const node = sourceNode(
      jsonMeta,
      at({ a: 1, b: 2 }),
      at({ b: 2, a: 1 }),
      "json"
    );
    expect(node.status).toBe("unchanged");
  });

  it("IDEMPOTENCE: a reordered key nested deeper is not a change either", () => {
    const node = sourceNode(
      jsonMeta,
      at({ outer: { a: 1, b: 2 } }),
      at({ outer: { b: 2, a: 1 } }),
      "json"
    );
    expect(node.status).toBe("unchanged");
  });

  it("MUST DIFFER: a changed value, on its own line", () => {
    const node = sourceNode(
      jsonMeta,
      at({ a: 1, b: 2 }),
      at({ a: 1, b: 3 }),
      "json"
    );
    expect(node.status).toBe("changed");
    expect(node.lines.filter(l => l.status !== "unchanged")).toHaveLength(1);
  });

  it("MUST DIFFER: array order, which is content rather than key order", () => {
    // Sorting keys must not turn into sorting arrays: [1,2] and [2,1] are
    // different values, and an author who reorders a list changed something.
    const node = sourceNode(
      jsonMeta,
      at({ xs: [1, 2] }),
      at({ xs: [2, 1] }),
      "json"
    );
    expect(node.status).toBe("changed");
  });

  it("reports an added key as an added line", () => {
    const node = sourceNode(jsonMeta, at({ a: 1 }), at({ a: 1, c: 9 }), "json");
    expect(node.lines.some(l => l.status === "added")).toBe(true);
  });

  it("distinguishes a stored null from an absent value", () => {
    // A json field can hold the primitive `null` as a real stored value, so
    // only a MISSING key is an absence. Treating null as absent emitted an
    // object-to-null edit as removed lines with nothing on the other side,
    // never showing the value that is now there.
    expect(sourceNode(jsonMeta, missing, at({ a: 1 }), "json").status).toBe(
      "added"
    );
    expect(sourceNode(jsonMeta, at({ a: 1 }), missing, "json").status).toBe(
      "removed"
    );
    // null is a VALUE on both sides, so these are ordinary changes.
    expect(sourceNode(jsonMeta, at(null), at({ a: 1 }), "json").status).toBe(
      "changed"
    );
    expect(sourceNode(jsonMeta, at({ a: 1 }), at(null), "json").status).toBe(
      "changed"
    );
  });

  it("shows a stored null as a line rather than as nothing", () => {
    // The content half of the same defect: the field-level status can be
    // repaired downstream, but discarded lines cannot.
    const node = sourceNode(jsonMeta, at({ a: 1 }), at(null), "json");
    const added = node.lines.filter(l => l.status !== "removed");
    expect(
      added.some(l => (l.segments ?? []).some(seg => seg.text.includes("null")))
    ).toBe(true);
  });

  it("gives an absent side no lines of its own, rather than a fabricated null", () => {
    // An absent side used to reach here already normalized to `null`, so the
    // comparison printed that `null` as a line and aligned it against the whole
    // of the other side: an added field opened with a two-sided `null` -> `{`
    // change, and every line number after it was off by one.
    const node = sourceNode(jsonMeta, missing, at({ cfg: { a: 1 } }), "json");
    expect(node.status).toBe("added");
    expect(node.lines.map(l => l.status)).toEqual(
      node.lines.map(() => "added")
    );
    expect(node.lines.every(l => l.fromLine === undefined)).toBe(true);
    expect(printed(node)).not.toContain("null");
  });

  it("gives a removed side no lines on the side it is not on", () => {
    const node = sourceNode(jsonMeta, at({ cfg: { a: 1 } }), missing, "json");
    expect(node.status).toBe("removed");
    expect(node.lines.every(l => l.status === "removed")).toBe(true);
    expect(node.lines.every(l => l.toLine === undefined)).toBe(true);
  });

  it("MUST DIFFER: values differing only under an own __proto__ key", () => {
    // Assigning `__proto__` to an ordinary object invokes the legacy prototype
    // setter instead of creating an enumerable property, so `JSON.stringify`
    // omits it and two different values canonicalise to the same `{}`.
    const a = JSON.parse('{"__proto__":{"role":"reader"}}') as unknown;
    const b = JSON.parse('{"__proto__":{"role":"admin"}}') as unknown;
    expect(sourceNode(jsonMeta, at(a), at(b), "json").status).toBe("changed");
  });

  it("carries the language so the renderer knows what to highlight", () => {
    expect(
      sourceNode(jsonMeta, at({ a: 1 }), at({ a: 2 }), "json").language
    ).toBe("json");
  });

  it("MUST DIFFER: a nested key reordering is still not a change", () => {
    const a = { outer: { inner: { x: 1, y: 2 } } };
    const b = { outer: { inner: { y: 2, x: 1 } } };
    expect(sourceNode(jsonMeta, at(a), at(b), "json").status).toBe("unchanged");
  });
});

describe("sourceNode — hashed passwords", () => {
  // A password field is skipped while it is declared as one. These are values
  // captured while the field WAS a password and read back after it was retyped
  // as json or code, which is the only way a hash reaches this comparison.

  it("never prints a stored hash", () => {
    const node = sourceNode(
      jsonMeta,
      at({ legacy: hash("a") }),
      at({ legacy: hash("b") }),
      "json"
    );
    expect(printed(node)).not.toContain("$2b$");
    expect(printed(node)).toContain("[protected]");
  });

  it("MUST DIFFER: two different hashes are still a change", () => {
    // Masking is a projection, and a comparison over a projection reports
    // "same" for whatever it dropped. Deciding equality on the masked form
    // would report a changed password as unchanged — the reassuring direction
    // to be wrong in.
    const node = sourceNode(
      jsonMeta,
      at({ legacy: hash("a") }),
      at({ legacy: hash("b") }),
      "json"
    );
    expect(node.status).toBe("changed");
    expect(node.lines.some(l => l.status === "changed")).toBe(true);
  });

  it("IDEMPOTENCE: one unchanged hash is not reported as a change", () => {
    const same = { legacy: hash("a") };
    const node = sourceNode(jsonMeta, at(same), at({ ...same }), "json");
    expect(node.status).toBe("unchanged");
  });

  it("masks a code field that holds nothing but a hash", () => {
    const node = sourceNode(
      codeMeta,
      at(hash("a")),
      at(hash("b")),
      "plaintext"
    );
    expect(printed(node)).not.toContain("$2b$");
    expect(node.status).toBe("changed");
  });
});

describe("sourceNode — code", () => {
  it("MUST DIFFER: one changed line among several", () => {
    const node = sourceNode(
      codeMeta,
      at("const a = 1;\nconst b = 2;\nconst c = 3;"),
      at("const a = 1;\nconst b = 9;\nconst c = 3;"),
      "typescript"
    );
    expect(node.language).toBe("typescript");
    expect(node.lines.filter(l => l.status !== "unchanged")).toHaveLength(1);
    expect(node.lines).toHaveLength(3);
  });

  it("carries word-level runs within a changed line", () => {
    const node = sourceNode(
      codeMeta,
      at("let x = 1;"),
      at("let y = 1;"),
      "plaintext"
    );
    const inserted = (node.lines[0]?.segments ?? []).filter(s => s.op === 1);
    expect(inserted.map(s => s.text).join("")).toContain("y");
  });

  it("numbers lines on the side each exists on", () => {
    const node = sourceNode(codeMeta, at("a\nb"), at("a\nx\nb"), "plaintext");
    const added = node.lines.find(l => l.status === "added");
    expect(added?.toLine).toBe(1);
    const last = node.lines[node.lines.length - 1];
    expect(last).toMatchObject({ status: "unchanged", fromLine: 1, toLine: 2 });
  });

  it("IDEMPOTENCE: identical code reports unchanged", () => {
    const src = "const a = 1;\nconst b = 2;";
    expect(sourceNode(codeMeta, at(src), at(src), "plaintext").status).toBe(
      "unchanged"
    );
  });
});

describe("sourceNode — what it cannot represent", () => {
  it("refuses rather than reporting equality when a value will not serialise", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const node = sourceNode(jsonMeta, at(cyclic), at({ a: 1 }), "json");
    expect(node.lines).toEqual([{ status: "unsupported" }]);
    expect(node.status).toBe("changed");
  });

  it("refuses when a code field holds something that is not a string", () => {
    // Nothing can be claimed about a value the projection cannot express, and
    // "unchanged" is the one answer that must not be given.
    const node = sourceNode(
      codeMeta,
      at({ not: "code" }),
      at("real code"),
      "plaintext"
    );
    expect(node.lines).toEqual([{ status: "unsupported" }]);
    expect(node.status).not.toBe("unchanged");
  });

  it("keeps the presence answer when only the content is unreadable", () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const node = sourceNode(jsonMeta, missing, at(cyclic), "json");
    expect(node.status).toBe("added");
  });
});

describe("sourceNode — presence survives a refusal", () => {
  /**
   * A value with more distinct lines than the alignment alphabet holds cannot
   * be aligned, and the node then reports that it is not comparable. What the
   * refusal must NOT discard is which sides held anything: whether a field was
   * added, removed, or edited is still known, and it is the answer a reader
   * uses to decide whether to restore.
   *
   * The sibling branch above — content unreadable on one side — already keeps
   * presence for exactly this reason. Two refusals in one function answering
   * the same question differently is the divergence being closed.
   */
  const tooManyLines = Array.from({ length: 200_000 }, (_, i) => `l${i}`).join(
    "\n"
  );

  it("reports an added field as added, not merely changed", () => {
    const node = sourceNode(codeMeta, missing, at(tooManyLines), "javascript");
    // The premise: this really is a refusal, so the assertion below is about
    // the refusal path and not some ordinary comparison.
    expect(node.lines.every(l => l.status === "unsupported")).toBe(true);
    expect(node.status).toBe("added");
  });

  it("reports a removed field as removed, not merely changed", () => {
    const node = sourceNode(codeMeta, at(tooManyLines), missing, "javascript");
    expect(node.lines.every(l => l.status === "unsupported")).toBe(true);
    expect(node.status).toBe("removed");
  });

  /**
   * The control. With both sides present there is no presence answer to keep,
   * so the refusal still reports `changed` — and if this ever came back as
   * `added` or `removed`, presence would be being invented rather than
   * preserved.
   */
  it("still reports changed when both sides held a value", () => {
    const node = sourceNode(
      codeMeta,
      at(tooManyLines),
      at(`${tooManyLines}\nextra`),
      "javascript"
    );
    expect(node.status).toBe("changed");
  });
});
