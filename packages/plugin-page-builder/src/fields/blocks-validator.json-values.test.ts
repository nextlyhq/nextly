/**
 * `BlockNode.props` is `Record<string, unknown>`, so a server-side or Direct
 * API caller can put values there that the JSON column cannot hold. The write
 * path stringifies the document, where a bigint throws and a function or
 * symbol is silently dropped, so the check belongs before the value is
 * accepted rather than after it reaches the serializer.
 */
import {
  DEFAULT_MAX_DOCUMENT_BYTES,
  DOCUMENT_FORMAT_VERSION,
} from "@nextlyhq/blocks-engine";
import { describe, expect, it, vi } from "vitest";

import { validateBlocksValue } from "./blocks-validator";

function withProps(props: Record<string, unknown>) {
  return {
    formatVersion: DOCUMENT_FORMAT_VERSION,
    kind: "page",
    nodes: [
      {
        id: "11111111-1111-4111-8111-111111111111",
        type: "core/heading",
        version: 1,
        props,
      },
    ],
  };
}

const codes = (value: unknown) =>
  validateBlocksValue(value, "content", "content", {}).map(i => i.code);

describe("unserializable values in a document", () => {
  it("accepts ordinary JSON values", () => {
    expect(
      codes(withProps({ text: "hi", n: 1, b: true, o: { a: [1, 2] } }))
    ).toEqual([]);
  });

  it("rejects a bigint, which the write path would throw on", () => {
    expect(codes(withProps({ count: 1n }))).toContain("UNSERIALIZABLE_VALUE");
  });

  it("rejects a function and a symbol, which would be dropped silently", () => {
    expect(codes(withProps({ fn: () => 1 }))).toContain("UNSERIALIZABLE_VALUE");
    expect(codes(withProps({ s: Symbol("x") }))).toContain(
      "UNSERIALIZABLE_VALUE"
    );
  });

  it("reports one verdict per defect, not a summary beside the precise one", () => {
    // The precise walk names the KEY, so the engine's document-level summary of
    // the same defect is redundant. Both summaries are superseded, because that
    // walk covers every value the writer mishandles rather than only the ones
    // it refuses: a bigint is the unwritable case, a function or symbol the
    // lossy one. Leaving either in place spends the issue allowance twice on
    // one repair and hands the caller a generic verdict next to an actionable
    // one.
    for (const props of [{ count: 1n }, { fn: () => 1 }, { s: Symbol("x") }]) {
      const reported = codes(withProps(props));
      expect(reported).toContain("UNSERIALIZABLE_VALUE");
      expect(reported).not.toContain("document-unwritable");
      expect(reported).not.toContain("document-lossy");
    }
  });

  it("names every offending key rather than stopping at the first", () => {
    const issues = validateBlocksValue(
      withProps({ a: 1n, b: 2n }),
      "content",
      "content",
      {}
    );
    expect(issues[0].message).toContain("a");
    expect(issues[0].message).toContain("b");
  });

  it("does not serialize a document the engine already refused as too large", () => {
    // The engine counts bytes without materializing, and stops at the cap — so
    // an oversized document may be arbitrarily larger than the limit it broke.
    // Serializing it here to name an offending key would allocate the full copy
    // the counter exists to avoid, immediately before rejecting the document
    // anyway.
    const oversized = withProps({
      big: "x".repeat(DEFAULT_MAX_DOCUMENT_BYTES * 2),
    });
    const small = withProps({ ok: 1 });
    const stringify = vi.spyOn(JSON, "stringify");

    try {
      const serialized = (value: unknown) =>
        stringify.mock.calls.some(([subject]) => subject === value);

      expect(codes(oversized)).toContain("document-too-large");
      expect(serialized(oversized)).toBe(false);

      // The control: the same spy DOES observe the walk on a document that was
      // not refused. Without it, "never serialized" would also be the reading
      // if this validator had stopped serializing anything at all.
      codes(small);
      expect(serialized(small)).toBe(true);
    } finally {
      stringify.mockRestore();
    }
  });

  it("rejects a circular document without throwing", () => {
    // The engine's size check reaches this first and reports it under its own
    // code; what matters here is that a cycle is refused rather than raised.
    const doc = withProps({}) as Record<string, unknown>;
    doc.self = doc;
    expect(() =>
      validateBlocksValue(doc, "content", "content", {})
    ).not.toThrow();
    expect(codes(doc).length).toBeGreaterThan(0);
  });
});
