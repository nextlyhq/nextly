/**
 * Whether a plugin can reach AND call the draft-split question.
 *
 * The class-usage write path must know whether a collection stores a working
 * draft: enumerating a draft subject for one that keeps none writes rows no
 * query built from a real document can reach, so nothing reconciles them and
 * nothing sweeps them.
 *
 * A RUNTIME test through `@nextlyhq/plugin-sdk`, deliberately, and both halves
 * of that are load-bearing.
 *
 * Runtime, because a type-only import proves nothing about the emitted
 * JavaScript: changing the producer to `export type` would leave every
 * type-level assertion green while a plugin's actual import disappeared. A
 * one-off look at the built artifact does not close that either — it is not a
 * control, because nothing re-runs it.
 *
 * Through the SDK, because that is the only surface a plugin may depend on.
 * Importing from `nextly` here would test a path no plugin is allowed to take,
 * and would pass while the supported one stayed broken.
 *
 * @module draft-split-reach.test
 */
import { describe, expect, it } from "vitest";

import { collectionDraftSplit } from "@nextlyhq/plugin-sdk";

describe("reaching the draft-split question from a plugin", () => {
  it("is a callable value on the supported surface, not just a type", () => {
    expect(typeof collectionDraftSplit).toBe("function");
  });

  it("answers for a collection that asked for nothing", async () => {
    // No versioning, so nothing requested the split and there is no cause to
    // report. A reason here would be noise on every ordinary collection.
    const verdict = await collectionDraftSplit({ fields: [] });

    expect(verdict.eligible).toBe(false);
    expect(verdict.reason).toBeNull();
  });

  it("understands the AUTHORED shorthand rather than a resolved shape", async () => {
    // The oracle for the whole export. `versions: true` is what an author
    // writes; `{ drafts: { enabled: true } }` is what config load produces and
    // what nobody writes by hand. A version of this that only read the resolved
    // shape would find nothing named `drafts.enabled`, conclude that versioning
    // never asked for the split, and answer `reason: null` — the SAME answer as
    // the case above, for a collection whose drafts are on.
    //
    // Reading `lifecycle-disabled` instead is what proves the shorthand was
    // expanded: that cause is only reachable once drafts versioning is known to
    // be enabled.
    const verdict = await collectionDraftSplit({
      status: false,
      versions: true,
      fields: [],
    });

    expect(verdict.reason).toBe("lifecycle-disabled");
  });

  it("does not hand every ELIGIBLE caller the same verdict object", async () => {
    // A module-level constant returned by reference would let one caller
    // mutating its verdict change every later one — including the verdicts the
    // schema and mutation paths read.
    //
    // The fixture has to be an ELIGIBLE collection. An ineligible one such as
    // `{ fields: [] }` takes an early return that builds a fresh literal on
    // every call, so it holds whether or not the eligible verdict is shared and
    // this assertion would pass without reaching the question.
    const enabled = { status: true, versions: true, fields: [] };
    const first = await collectionDraftSplit(enabled);
    const second = await collectionDraftSplit(enabled);

    // Reaching the shared path is the precondition, so it is asserted rather
    // than assumed — an `eligible: false` here would silently put this back on
    // the branch that cannot detect the defect.
    expect(first.eligible).toBe(true);
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
