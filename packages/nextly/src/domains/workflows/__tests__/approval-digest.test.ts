/**
 * The approval digest: one value for one content, whatever order its keys were written in and
 * whatever the framework's own keys say, and another value for other content.
 */
import { describe, expect, it } from "vitest";

import { approvalDigest } from "../approval-digest";

const CONTENT = {
  title: "Hello",
  body: { blocks: [{ type: "p", text: "Hi" }], meta: { a: 1, b: 2 } },
};

describe("approvalDigest", () => {
  it("is sha256 hex", () => {
    expect(approvalDigest(CONTENT, "collection")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("does not depend on key order, at any depth", () => {
    const reordered = {
      body: { meta: { b: 2, a: 1 }, blocks: [{ text: "Hi", type: "p" }] },
      title: "Hello",
    };
    expect(approvalDigest(reordered, "collection")).toBe(
      approvalDigest(CONTENT, "collection")
    );
  });

  it("leaves out the framework's own keys, which move on saves that change no content", () => {
    const withSystemKeys = {
      ...CONTENT,
      id: "e1",
      createdAt: "2026-11-01T00:00:00.000Z",
      updatedAt: "2026-11-04T00:00:00.000Z",
      status: "draft",
      createdBy: "u1",
      _rev: "4.en:2",
    };
    expect(approvalDigest(withSystemKeys, "collection")).toBe(
      approvalDigest(CONTENT, "collection")
    );
  });

  it("differs for other content, and for an added block", () => {
    const base = approvalDigest(CONTENT, "collection");
    expect(
      approvalDigest({ ...CONTENT, title: "Hello!" }, "collection")
    ).not.toBe(base);
    expect(
      approvalDigest(
        {
          ...CONTENT,
          body: {
            ...CONTENT.body,
            blocks: [...CONTENT.body.blocks, { type: "p", text: "Two" }],
          },
        },
        "collection"
      )
    ).not.toBe(base);
  });

  it("leaves out the exempt fields it is given, and only those", () => {
    const exempt = ["seoTitle"];
    const base = approvalDigest(
      { ...CONTENT, seoTitle: "One" },
      "collection",
      exempt
    );
    // An exempt field's value, or its absence, does not move the digest.
    expect(
      approvalDigest({ ...CONTENT, seoTitle: "Two" }, "collection", exempt)
    ).toBe(base);
    expect(approvalDigest(CONTENT, "collection", exempt)).toBe(base);
    // Without the exemption the same edit is a change.
    expect(
      approvalDigest({ ...CONTENT, seoTitle: "One" }, "collection")
    ).not.toBe(approvalDigest({ ...CONTENT, seoTitle: "Two" }, "collection"));
    // Another field still counts.
    expect(
      approvalDigest(
        { ...CONTENT, title: "Other", seoTitle: "One" },
        "collection",
        exempt
      )
    ).not.toBe(base);
  });

  it("reads a field holding no value as one that is absent, as a recorded version may hold either", () => {
    // A version recorded at create leaves out a translated field never set; one recorded by a
    // later save holds it as null. The same content, so the same digest.
    expect(approvalDigest({ ...CONTENT, subtitle: null }, "collection")).toBe(
      approvalDigest(CONTENT, "collection")
    );
    // A value is still content.
    expect(
      approvalDigest({ ...CONTENT, subtitle: "Sub" }, "collection")
    ).not.toBe(approvalDigest(CONTENT, "collection"));
  });

  it("reads a snapshot stored as JSON text as the value it holds", () => {
    expect(approvalDigest(JSON.stringify(CONTENT), "collection")).toBe(
      approvalDigest(CONTENT, "collection")
    );
  });
});
