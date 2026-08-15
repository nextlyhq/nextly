import { describe, expect, it } from "vitest";

import { validateBlocksValue } from "./blocks-validator";

describe("an unreadable document is not serialized afterwards", () => {
  it("does not invoke an accessor the byte survey refused to read", () => {
    // The survey declines to invoke an accessor so document-supplied code never
    // runs inside a precondition. `unserializableIssues` calls JSON.stringify,
    // which invokes it — so a gate that lets the precise walk proceed executes
    // exactly the code the refusal existed to avoid, and materializes whatever
    // it returns.
    let invoked = 0;
    const props: Record<string, unknown> = {};
    Object.defineProperty(props, "payload", {
      enumerable: true,
      get() {
        invoked += 1;
        return "x".repeat(1_000_000);
      },
    });

    const doc = {
      formatVersion: 1,
      kind: "page",
      nodes: [{ id: "n1", type: "core/text", version: 1, props }],
    };

    const issues = validateBlocksValue(doc, "blocks", "Blocks", {});

    expect(issues.some(i => i.code === "document-unreadable")).toBe(true);
    // Zero, not "few". One invocation is the whole defect.
    expect(invoked).toBe(0);
  });
});
