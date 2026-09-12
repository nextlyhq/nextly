/**
 * Reading a registry sync's report.
 *
 * The case that matters is the one `errors[]` alone cannot express: both
 * registries push a slug onto `created`/`updated` BEFORE awaiting the
 * permission seeding that follows the write, and the catch around that await
 * appends to `errors`. A slug in BOTH lists therefore means the row landed and
 * something after it failed -- and reading that as a refusal withholds a
 * source whose metadata is current, permanently, because every later pass
 * reads the same report the same way.
 */

import { describe, expect, it } from "vitest";

import { erroredSlugs, rewrittenSlugs, unwrittenSlugs } from "../sync-outcome";

const report = (r: {
  created?: unknown;
  updated?: unknown;
  errors?: unknown;
}) => r;

describe("unwrittenSlugs", () => {
  it("takes a slug the sync refused outright", () => {
    expect(
      unwrittenSlugs(report({ created: [], errors: [{ slug: "posts" }] }))
    ).toEqual(["posts"]);
  });

  it("LEAVES a slug whose row was written and which errored afterwards", () => {
    // 🔴 The whole point. `posts` is in both lists, so its row is current.
    expect(
      unwrittenSlugs(
        report({ created: ["posts"], errors: [{ slug: "posts" }] })
      )
    ).toEqual([]);
  });

  it("leaves one whose row was UPDATED and which errored afterwards", () => {
    // The other write verb reports through a different list, and a reading
    // that checked only `created` would withhold every edited entity.
    expect(
      unwrittenSlugs(
        report({ updated: ["posts"], errors: [{ slug: "posts" }] })
      )
    ).toEqual([]);
  });

  it("separates the two within one report", () => {
    // The discriminating case: a batch where one slug landed-then-failed and
    // another was refused. A reading that answered all-or-nothing would match
    // one of the cases above and neither of these.
    expect(
      unwrittenSlugs(
        report({
          created: ["landed"],
          updated: [],
          errors: [{ slug: "landed" }, { slug: "refused" }],
        })
      )
    ).toEqual(["refused"]);
  });

  it("answers nothing for a clean report, and for a shape it cannot read", () => {
    // The registries are reached through a duck-typed surface here, so a fake
    // may resolve anything at all -- and "cannot read it" must not become
    // "everything failed", which would withhold every source in the install.
    expect(unwrittenSlugs(report({ created: ["a"], errors: [] }))).toEqual([]);
    expect(unwrittenSlugs(undefined)).toEqual([]);
    expect(unwrittenSlugs(null)).toEqual([]);
    expect(unwrittenSlugs("not a report")).toEqual([]);
    expect(unwrittenSlugs(report({ errors: "not an array" }))).toEqual([]);
    expect(unwrittenSlugs(report({ errors: [{}, 7, null] }))).toEqual([]);
  });
});

describe("erroredSlugs", () => {
  it("keeps a post-write failure, which is what makes it the wrong input for withholding", () => {
    // The raw reading has its own callers -- a failed permission seed is worth
    // logging. Asserted beside `unwrittenSlugs` so the difference between them
    // is visible rather than inferred from two files.
    expect(
      erroredSlugs(report({ created: ["posts"], errors: [{ slug: "posts" }] }))
    ).toEqual(["posts"]);
  });
});

describe("rewrittenSlugs", () => {
  it("names the rows the sync updated, and not the ones it created", () => {
    // `created` rows are caught by the caller's own absent-table reading; a row
    // reported here is one whose `migration_status` the update reset.
    expect(
      rewrittenSlugs(report({ created: ["new"], updated: ["edited"] }))
    ).toEqual(["edited"]);
  });

  it("answers nothing for a shape it cannot read", () => {
    expect(rewrittenSlugs(undefined)).toEqual([]);
    expect(rewrittenSlugs(report({ updated: "not an array" }))).toEqual([]);
  });
});
