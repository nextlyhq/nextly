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

  it("indexes the column the library filters on, in a form the pipeline builds", () => {
    // The read this table exists to serve is "given a class, which documents
    // reference it". A collection-level `indexes` entry does not reach the
    // schema pipeline — `buildDesiredTableFromFields` is given the fields and
    // derives only system and per-field indexes — so the index has to be
    // declared on the field or it exists only in the config.
    const classId = contributed().fields.find(
      f => "name" in f && f.name === "classId"
    );

    expect(classId).toBeDefined();
    expect(classId).toMatchObject({ index: true });
  });

  it("declares no collection-level index, which would not be built", () => {
    // Asserted rather than left absent: a declared index reads as a constraint
    // to anyone who finds it, and this one would never exist in the database.
    // The empty-string entity key and the reconciler's duplicate removal are
    // what the design rests on instead.
    expect(contributed().indexes).toBeUndefined();
  });

  it("records no webhook event for its writes", () => {
    // An OMITTED option records: the registry reads `webhooks?.record !== false`
    // and `undefined` satisfies it. So a site with an endpoint subscribed to
    // `entry.*` would receive every row this table writes, carrying the full
    // document — and access rules are not consulted for outbox delivery, so
    // the closed rules above do not cover that path.
    expect(contributed().webhooks).toBe(false);
  });

  it("stores no timestamps", () => {
    // A row is a fact derived from a document, not an event. A `createdAt` here
    // answers when the ROW was written, which is not when the reference
    // appeared, and the two differ by every rebuild.
    expect(classUsageIndexCollection().timestamps).toBe(false);
  });
});
