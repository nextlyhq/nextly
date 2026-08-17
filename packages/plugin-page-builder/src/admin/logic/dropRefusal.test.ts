import { describe, expect, it } from "vitest";

import { defaultBlockRegistry } from "../../core/registry";
import { makeNode } from "../../core/tree";
import "../../render/blocks"; // register core blocks

import { planDrop } from "./dropPlan";
import { DROP_REFUSALS, dropRefusalMessage } from "./dropRefusal";

describe("dropRefusalMessage", () => {
  it("has a distinct sentence for every reason", () => {
    // Asserted by MEMBERSHIP rather than by a count: two reasons sharing a sentence keeps the
    // total right while telling the author the same thing about different rules, which is the
    // generic message a `default` arm would have produced.
    const messages = DROP_REFUSALS.map(dropRefusalMessage);
    expect(new Set(messages).size).toBe(DROP_REFUSALS.length);
    for (const message of messages) expect(message.length).toBeGreaterThan(0);
  });

  it("explains a refusal taken from the planner, not from its own key list", () => {
    // `DROP_REFUSALS` is derived from `MESSAGES`, so looping over it and asserting each key has a
    // message cannot fail — it asks the record about itself. What the compiler ALREADY guarantees
    // is the other half: `Record<DropRefusal, string>` will not build if a reason has no sentence.
    //
    // So the thing left to observe is that the two ends meet at runtime: a reason produced by a
    // real drag, carried through `planDrop`, resolves to the sentence the author reads.
    const columns = makeNode("core/columns", {}, undefined, { default: [] });
    const root = makeNode("core/container", {}, undefined, {
      default: [columns],
    });
    const outcome = planDrop(
      { kind: "library", blockType: "core/heading" },
      { kind: "dropzone", parentId: columns.id, slot: "default", index: 0 },
      root,
      defaultBlockRegistry
    );
    expect(outcome.kind).toBe("refused");
    if (outcome.kind !== "refused") return;
    expect(DROP_REFUSALS).toContain(outcome.reason);
    expect(dropRefusalMessage(outcome.reason)).toBe(
      "This container doesn’t accept this kind of block."
    );
  });
});
