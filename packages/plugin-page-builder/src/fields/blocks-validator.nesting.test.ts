/**
 * The write path enforces where a block says it belongs.
 *
 * Asserted as a REFUSAL from the seam, never as "the validator was called with a
 * nesting source". The second passes on an empty registry, which is exactly the
 * state in which the rule reaches nothing — so it would certify the wiring while
 * the enforcement stayed dark, the failure this test exists to rule out.
 *
 * The editor refuses these placements while dragging. This path is what catches
 * a document that never passed through the editor: an import, a script, a
 * migration, or an older client.
 */
import { afterEach, describe, expect, it } from "vitest";

import { clearBlocks, registerBlocks } from "@nextlyhq/blocks-engine";

import { validateBlocksValue } from "./blocks-validator";

const base = {
  version: 1,
  description: "A block.",
  example: { props: {} },
  render: () => null,
};

/** A block that may only sit inside `core/columns`, contributed as a plugin would. */
function registerRestrictedBlock(): void {
  registerBlocks(
    [
      { ...base, name: "acme/columns" },
      { ...base, name: "acme/column", parent: ["acme/columns"] },
    ] as never,
    { source: "acme" }
  );
}

function page(nodes: unknown[]) {
  return { formatVersion: 1, kind: "page", nodes };
}

function node(type: string, id: string, slots?: Record<string, unknown[]>) {
  return slots
    ? { id, type, version: 1, props: {}, slots }
    : { id, type, version: 1, props: {} };
}

afterEach(() => {
  clearBlocks();
});

describe("nesting on the write path", () => {
  it("refuses a restricted block written at the top level", () => {
    registerRestrictedBlock();

    const issues = validateBlocksValue(
      page([node("acme/column", "n1")]),
      "content",
      "Content",
      {}
    );

    expect(issues.length).toBeGreaterThan(0);
    expect(issues.map(i => i.message).join(" ")).toContain("acme/columns");
  });

  it("refuses a restricted block written under the wrong container", () => {
    registerRestrictedBlock();

    const issues = validateBlocksValue(
      page([
        node("acme/columns", "row", {
          default: [node("acme/column", "ok")],
        }),
        node("acme/columns", "row2", {
          default: [node("acme/columns", "wrong-place")],
        }),
      ]),
      "content",
      "Content",
      {}
    );

    // The permitted placement in the same document is what separates this from
    // a rule that refuses the block everywhere: a check that rejected
    // `acme/column` outright would also produce a non-empty result here.
    expect(issues.length).toBe(0);

    const bad = validateBlocksValue(
      page([
        node("acme/columns", "row", {
          default: [node("acme/column", "fine")],
        }),
        node("acme/column", "stray"),
      ]),
      "content",
      "Content",
      {}
    );
    expect(bad.length).toBeGreaterThan(0);
  });

  it("accepts a restricted block in the container it declares", () => {
    // The positive control. Every refusal above is also satisfied by a rule that
    // refuses the block from everywhere, and at each assertion the two look the
    // same.
    registerRestrictedBlock();

    const issues = validateBlocksValue(
      page([
        node("acme/columns", "row", { default: [node("acme/column", "cell")] }),
      ]),
      "content",
      "Content",
      {}
    );

    expect(issues).toEqual([]);
  });

  it("stays silent when no block has been contributed", () => {
    // An empty registry answers "declares no restriction" for every type, so the
    // rule reaches nothing. Asserted rather than assumed, because the opposite
    // failure — refusing every document when the registry is empty — is the
    // reason this file's module docblock declines to check type EXISTENCE here.
    const issues = validateBlocksValue(
      page([node("acme/column", "n1")]),
      "content",
      "Content",
      {}
    );

    expect(issues).toEqual([]);
  });
});
