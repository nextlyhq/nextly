/**
 * Whether the index collection is a config the host will actually accept, and
 * whether its constraints describe the columns it declares.
 *
 * A collection definition nothing constructs is a set of claims: it type-checks
 * against the config types and is never validated against the rules the host
 * applies at boot. These cases construct it through the plugin, which is where
 * an invalid rule stops being a claim and becomes an error.
 *
 * @module collections/class-usage-index.test
 */
import { describe, expect, it } from "vitest";

import { pageBuilder } from "../plugin";

import {
  CLASS_USAGE_INDEX_SLUG,
  CLASS_USAGE_KEY_FIELDS,
  classUsageIndexCollection,
} from "./class-usage-index";

/** The index as the plugin contributes it, built the way a host builds it. */
const contributed = () => {
  const collections = pageBuilder().contributes?.collections ?? [];
  const index = collections.find(c => c.slug === CLASS_USAGE_INDEX_SLUG);
  if (index === undefined)
    throw new Error("the plugin contributes no usage index");
  return index;
};

describe("the class-usage index collection", () => {
  it("is contributed by the plugin, and survives config validation", () => {
    // `defineCollection` validates, so an access rule of the wrong TYPE — the
    // shape a reader naturally writes for "nobody may do this" — throws here
    // rather than at a host's boot. Constructing through the plugin is what
    // makes that reachable: the definition alone is only ever type-checked.
    expect(contributed().slug).toBe(CLASS_USAGE_INDEX_SLUG);
  });

  it("refuses all four operations over the wire", () => {
    // These rules are the ONLY thing keeping the table private. `internal`
    // sets `admin.hidden` and nothing else, so an internal collection is
    // routed and dispatched exactly like any other.
    const access = contributed().access ?? {};
    for (const rule of ["create", "read", "update", "delete"] as const) {
      const fn = access[rule];
      expect(typeof fn).toBe("function");
      // Called with no argument on purpose: a rule that refuses only for SOME
      // caller is not a closed door, and one that reads its argument would
      // throw here rather than quietly answering for the anonymous case.
      expect((fn as () => unknown)()).toBe(false);
    }
  });

  it("constrains exactly the five columns that identify a reference", () => {
    // The empty-string entity key is only sound if these columns really are a
    // uniqueness constraint — a comment saying they form a total key is not
    // one. Written out here rather than compared against the constant the
    // collection builds from: a test that reads the same source the code reads
    // agrees with it however that source changes, and would not notice a
    // column leaving the key.
    const unique = (contributed().indexes ?? []).filter(i => i.unique === true);

    expect(unique).toHaveLength(1);
    expect(unique[0]?.fields).toEqual([
      "scope",
      "entity",
      "entityKey",
      "field",
      "classId",
    ]);
    // And the constant the collection is built from says the same, so the two
    // are checked against each other rather than only one being checked.
    expect([...CLASS_USAGE_KEY_FIELDS]).toEqual(unique[0]?.fields);
  });

  it("carries an index leading with the column the library filters on", () => {
    // The read this table exists to serve is "given a class, which documents
    // reference it". Without an index led by `classId` that question scans
    // every row — which is the cost the table was chosen to avoid, so its
    // absence would not fail anything, it would just make the feature slow in
    // exactly the way the design rejected.
    const byClass = (contributed().indexes ?? []).filter(
      i => i.unique !== true
    );

    expect(byClass).toHaveLength(1);
    expect(byClass[0]?.fields[0]).toBe("classId");
  });

  it("stores no timestamps", () => {
    // A row is a fact derived from a document, not an event. A `createdAt` here
    // answers when the ROW was written, which is not when the reference
    // appeared, and the two differ by every rebuild.
    expect(classUsageIndexCollection().timestamps).toBe(false);
  });
});
