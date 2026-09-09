/**
 * The words an author reads when a composition verb refuses.
 *
 * Two properties carry the weight. The map is TOTAL over the planner's causes,
 * so a planner that learns a new way to say no cannot reach a surface with
 * nothing to say — and the permitted list is humanised, because the rule answers
 * with registry specifiers and a namespace wildcard is not a block name.
 *
 * @module composition-refusal.test
 */
import { describe, expect, it } from "vitest";

import { compositionRefusalReason, isPlanProblem } from "./composition-refusal";

/** Every cause the engine publishes, as the union spells them. */
const EVERY_PROBLEM = [
  "empty",
  "unknown",
  "split",
  "gap",
  "wrong-parent",
  "restricted-at-root",
  "not-allowed-in-slot",
  "not-a-pattern",
  "duplicate-destination",
  "destination-locked",
  "dom-id-collision",
  "invalid-position",
  "invalid-node",
  "duplicate-dom-id",
  "unusable-document",
  "invalid-source",
  "invalid-exposure",
  "ambiguous-exposure",
  "exceeds-limits",
  "self-reference",
  "not-a-component",
  "condition-gated",
] as const;

describe("a sentence for every cause", () => {
  it.each(EVERY_PROBLEM)(
    "says something an author can act on for %s",
    cause => {
      const sentence = compositionRefusalReason({ problem: cause });

      // A complete sentence rather than a code echoed back. Asserted as a shape —
      // capitalised, ends in a full stop, more than a few words — because that is
      // what separates prose from `not-allowed-in-slot`, which is neither.
      //
      // NOT "does not contain the cause": "gap" is a perfectly good English word,
      // and a rule that forbade it would push the copy away from the plainest
      // sentence for the sake of a check.
      expect(sentence).toMatch(/^[A-Z].*\.$/);
      expect(sentence.split(" ").length).toBeGreaterThan(3);
    }
  );

  it("recognises every one of them as a cause, and nothing else", () => {
    // The guard is what a REFUSAL FROM THE WIRE goes through: the server sends
    // the planner's cause as a string, and the surface phrasing it holds no
    // typed union. Derived from the same map as the sentences, so the two
    // cannot disagree about which causes exist.
    for (const cause of EVERY_PROBLEM) expect(isPlanProblem(cause)).toBe(true);
    for (const other of ["", "GAP", "not-a-cause", "toString", "constructor"]) {
      expect(isPlanProblem(other)).toBe(false);
    }
    expect(isPlanProblem(undefined)).toBe(false);
  });
});

describe("naming the containers a block belongs in", () => {
  it("uses the block's LABEL, not its registry specifier", () => {
    // "It belongs inside core/columns" tells an author how this project names
    // its modules. The label is what every other surface calls the same block —
    // and an UNREGISTERED type is the harder case, because that is where a
    // naive reading would pass the specifier straight through.
    const sentence = compositionRefusalReason({
      problem: "restricted-at-root",
      permitted: ["core/columns"],
    });

    expect(sentence).toContain("Columns");
    expect(sentence).not.toContain("core/columns");
  });

  it("names a WILDCARD as the group it is, not as a block called *", () => {
    // A slot may admit a whole namespace. Read as a block name it humanises to
    // the bare "*", so the sentence would end "belongs inside *".
    const sentence = compositionRefusalReason({
      problem: "not-allowed-in-slot",
      permitted: ["core/*"],
    });

    expect(sentence).toContain("any core block");
    expect(sentence).not.toContain("*");
  });

  it("joins several with OR, because they are alternatives", () => {
    const sentence = compositionRefusalReason({
      problem: "restricted-at-root",
      permitted: ["core/a", "core/b", "core/c"],
    });

    expect(sentence).toMatch(/, .* or /);
  });

  it("says nothing about containers when the planner named none", () => {
    // The control. A sentence that always appended a list would append an empty
    // one for every cause that carries no `permitted`.
    const sentence = compositionRefusalReason({ problem: "gap" });

    expect(sentence).not.toContain("belongs inside");
  });
});
