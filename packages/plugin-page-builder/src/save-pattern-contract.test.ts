/**
 * Whether the shape the dialog fills still matches the table it writes to.
 *
 * `SavePatternFields` names the `patterns` collection's fields and cannot read
 * them: it lives in the import-free contract, because the surface that fills the
 * form runs in a browser and the collection module reaches the framework. A type
 * that names a source of truth it cannot track is how a contract goes quietly
 * stale — a field added to the collection is simply never asked for, and nothing
 * fails.
 *
 * The drift is caught from both sides, in two places, because neither place can
 * catch both. `SAVE_PATTERN_FIELD_NAMES` carries a `satisfies Record<keyof …>`
 * in the contract itself, which `tsc` evaluates, so the interface cannot move
 * without that list moving. This compares the list against the collection, which
 * only a running test can do.
 *
 * It is deliberately NOT the `Record<keyof …>` witness itself: this package's
 * `tsconfig.tests.json` keeps `*.test.ts` out of the type program, so a type
 * constraint written here is transpiled and never evaluated — a guard that
 * checks nothing while reading as though it checks everything.
 *
 * @module save-pattern-contract.test
 */
import { describe, expect, it } from "vitest";

import { patternsCollection } from "./collections/patterns";
import { SAVE_PATTERN_FIELD_NAMES } from "./library-contract";

/**
 * The field the planner owns.
 *
 * Excluded from the comparison rather than from the collection: the tree is
 * stored like any other field, and what makes it different is that a caller may
 * not supply it.
 */
const PLANNER_OWNED = "content";

describe("the save request and the collection it writes to", () => {
  const declared = patternsCollection()
    .fields.map(field => field.name)
    .filter(
      (name): name is string => name !== undefined && name !== PLANNER_OWNED
    );

  it("asks for exactly the fields the collection declares", () => {
    // Both directions in one comparison. A field added to the collection and
    // not to the request is one an author can never fill; a field added to the
    // request and not to the collection is one the route will drop, so the
    // dialog would offer a control whose value goes nowhere.
    expect([...SAVE_PATTERN_FIELD_NAMES].sort()).toEqual([...declared].sort());
  });

  it("finds fields at all, so the comparison is not vacuous", () => {
    // The control. An empty declared list would make the assertion above pass
    // against an empty request shape, and a collection this could not read
    // would look exactly like a contract in perfect agreement.
    expect(declared.length).toBeGreaterThan(1);
  });
});
