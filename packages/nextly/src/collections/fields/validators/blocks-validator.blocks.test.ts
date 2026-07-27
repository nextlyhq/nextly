/**
 * `BlockNode.props` is `Record<string, unknown>`, so a server-side or Direct
 * API caller can put values there that the JSON column cannot hold. The write
 * path stringifies the document, where a bigint throws and a function or
 * symbol is silently dropped, so the check belongs before the value is
 * accepted rather than after it reaches the serializer.
 */
import { DOCUMENT_FORMAT_VERSION } from "@nextlyhq/blocks-engine";
import { describe, expect, it } from "vitest";

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
