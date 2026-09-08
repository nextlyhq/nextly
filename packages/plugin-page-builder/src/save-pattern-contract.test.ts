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
 * This is the one assertion that notices. It runs in both directions: the record
 * below must gain a key when the interface does, or it will not compile, and its
 * keys are compared against what the collection actually declares.
 *
 * @module save-pattern-contract.test
 */
import { describe, expect, it } from "vitest";

import { patternsCollection } from "./collections/patterns";
import type { SavePatternFields } from "./library-contract";

/**
 * Every field of the request shape, as a value a test can read.
 *
 * `Record<keyof …>` rather than a literal list: adding a property to
 * `SavePatternFields` fails to compile here until it is named, which is what
 * makes this a witness for the interface rather than a second copy of it.
 */
const REQUEST_FIELDS: Record<keyof SavePatternFields, true> = {
  title: true,
  slug: true,
  granularity: true,
  description: true,
  category: true,
  keywords: true,
};

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
    expect(Object.keys(REQUEST_FIELDS).sort()).toEqual([...declared].sort());
  });

  it("finds fields at all, so the comparison is not vacuous", () => {
    // The control. An empty declared list would make the assertion above pass
    // against an empty request shape, and a collection this could not read
    // would look exactly like a contract in perfect agreement.
    expect(declared.length).toBeGreaterThan(1);
  });
});
