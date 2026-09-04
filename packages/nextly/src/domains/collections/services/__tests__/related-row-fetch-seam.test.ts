/**
 * A related row is fetched in exactly one place.
 *
 * Six call sites used to select from a target table themselves, and every
 * capability a related row was missing had to be added to each of them and then
 * audited for the one that was forgotten — an audit that has been run three
 * times (the caller's scope, the read locale, and two per-request caches). One
 * reader is what makes the next capability a single change instead of a sweep.
 *
 * Guarded structurally because the invariant is about where code MAY fetch, and
 * a behavioural test cannot see a seventh fetch site that happens to agree with
 * the other six today. This is the check that fails when someone adds one.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SOURCE = fileURLToPath(
  new URL("../collection-relationship-service.ts", import.meta.url)
);

/**
 * The queries allowed to read rows directly, each for a stated reason. A new
 * entry here is a decision, which is the point: adding one means explaining why
 * this row does not go through the reader every other row goes through.
 */
const ALLOWED_DIRECT_READS = [
  "readTargetRows — the reader itself",
  "narrowByTargetPredicate — re-reads under the rule's own predicate, so the row and the authorization to serve it come from one query",
  "fetchMediaByIds — media is not a collection: no read rules, no hooks, and its own URL absolutization",
] as const;

describe("related rows are fetched through one reader", () => {
  it("has exactly one direct read per documented reason", () => {
    const source = readFileSync(SOURCE, "utf8");

    // Drizzle's builder is the only way this service reads a table, so counting
    // `.select()` counts the fetch sites.
    const directReads = source.match(/\.select\(\)/g) ?? [];

    expect(
      directReads,
      `expected one direct read per documented reason:\n` +
        ALLOWED_DIRECT_READS.map(reason => `  - ${reason}`).join("\n") +
        `\n\nIf you added a fetch, route it through readTargetRows so it inherits ` +
        `the target collection's read rules, redaction, and everything added to ` +
        `expansion later. If it genuinely cannot, add it above with its reason.`
    ).toHaveLength(ALLOWED_DIRECT_READS.length);
  });

  it("routes every relationship fetch through the reader", () => {
    const source = readFileSync(SOURCE, "utf8");

    // The reader plus its callers. Fewer than this means a path was rewired to
    // fetch for itself again.
    const usages = source.match(/readTargetRows\(/g) ?? [];

    expect(usages.length).toBeGreaterThanOrEqual(5);
  });

  it("assembles an IN clause by hand only where Drizzle cannot", () => {
    const source = readFileSync(SOURCE, "utf8");

    // Junction tables are created by the many-to-many machinery and are not in
    // the Drizzle schema, so there is no table object to give `inArray` and the
    // list has to be built. Reading a target COLLECTION is different: it has a
    // schema, and the one hand-built list there was justified as MySQL
    // compatibility while the sibling batch path bound the same filter with
    // `inArray` and passed on MySQL.
    const handBuilt = source.match(/IN \(\$\{/g) ?? [];

    expect(
      handBuilt,
      "the junction-table read is the only place a list may be assembled by " +
        "hand. Anything with a Drizzle table object should use `inArray`, and " +
        "reading a target collection's rows should go through readTargetRows."
    ).toHaveLength(1);
  });
});
