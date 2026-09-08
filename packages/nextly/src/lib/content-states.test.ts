/**
 * The property the read path depends on, and the one that fails dangerously.
 *
 * `isPublicState` decides whether an untrusted caller may see a document, so
 * its wrong answer is not a display bug — it is unpublished content served to
 * the world. Every case below is written against that asymmetry: a false
 * negative hides something, a false positive publishes it.
 */
import { describe, expect, it } from "vitest";

import {
  DEFAULT_WORKFLOW,
  MAX_STATE_NAME_LENGTH,
  defineWorkflow,
  nonPublicStateNames,
  type ContentState,
  isPublicState,
  publicStateNames,
  type ContentWorkflow,
} from "./content-states";

/** A workflow with a state between the two, as a real team would define. */
const EDITORIAL: ContentWorkflow = {
  name: "editorial",
  states: [
    { name: "draft", isPublic: false },
    { name: "inReview", isPublic: false },
    { name: "published", isPublic: true },
  ],
};

describe("what a state means", () => {
  it("reproduces today's vocabulary exactly", () => {
    // The migration's whole safety argument: the default workflow must answer
    // precisely what the hardcoded literal answered, or phase 1 changes
    // behaviour while claiming not to.
    expect(publicStateNames()).toEqual(["published"]);
    expect(isPublicState("published")).toBe(true);
    expect(isPublicState("draft")).toBe(false);
  });

  it("treats a custom intermediate state as NOT public", () => {
    expect(publicStateNames(EDITORIAL)).toEqual(["published"]);
    expect(isPublicState("inReview", EDITORIAL)).toBe(false);
  });

  /*
   * The dangerous direction. A row can carry a state the workflow no longer
   * declares — someone edited the workflow after the row was written — and the
   * only safe answer is "not public". Answering true would publish a document
   * on the strength of nobody having decided about it.
   */
  it("refuses a state the workflow does not declare", () => {
    expect(isPublicState("legalHold")).toBe(false);
    expect(isPublicState("", DEFAULT_WORKFLOW)).toBe(false);
    expect(isPublicState("PUBLISHED")).toBe(false);
  });

  it("answers membership with the SAME list the read filter uses", () => {
    /*
     * The two helpers must never disagree, and the only guarantee is that one
     * of them does not walk `states` itself. A second walk agrees until the day
     * normalization or deduplication is added to one of them; the disagreement
     * then surfaces as a document the filter excluded and the predicate called
     * public — the direction that publishes unpublished work.
     */
    const workflows: ContentWorkflow[] = [DEFAULT_WORKFLOW, EDITORIAL];
    for (const workflow of workflows) {
      for (const state of [...workflow.states, { name: "unknown" }]) {
        expect(isPublicState(state.name, workflow)).toBe(
          publicStateNames(workflow).includes(state.name)
        );
      }
    }
    // The premise: this ran over states of BOTH kinds, so agreeing everywhere
    // is a real agreement rather than two empty answers.
    expect(publicStateNames(EDITORIAL).length).toBe(1);
    expect(EDITORIAL.states.length).toBeGreaterThan(1);
  });

  it("returns every public state, not merely the first", () => {
    // A workflow may have more than one public state — `published` and a
    // `featured` that is also live. Returning one would hide the other's rows
    // from every public read.
    const twoLive: ContentWorkflow = {
      name: "two-live",
      states: [
        { name: "draft", isPublic: false },
        { name: "published", isPublic: true },
        { name: "featured", isPublic: true },
      ],
    };
    expect(publicStateNames(twoLive)).toEqual(["published", "featured"]);
  });
});

describe("declaring a workflow", () => {
  /*
   * Every rule here is one whose violation is otherwise found at write time, on
   * one dialect, in production. Declaration is the only moment the whole set is
   * visible, so it is the only moment "two states share a name" or "nothing
   * here is public" can be seen at all.
   */
  const ok = (states: ContentState[]): ContentWorkflow =>
    defineWorkflow({ name: "editorial", states });

  it("returns the workflow unchanged when it is sound", () => {
    const states = [
      { name: "draft", label: "Draft", isPublic: false },
      { name: "in_review", label: "In legal review", isPublic: false },
      { name: "live", label: "Live", isPublic: true },
    ];
    expect(ok(states).states).toEqual(states);
  });

  it("refuses a state name the status column cannot hold", () => {
    // 21 characters against a varchar(20). SQLite would accept it and both
    // other dialects would not, so a suite run on SQLite says nothing.
    const tooLong = "awaiting_legal_review";
    expect(tooLong.length).toBeGreaterThan(MAX_STATE_NAME_LENGTH);
    expect(() =>
      ok([
        { name: "draft", isPublic: false },
        { name: tooLong, isPublic: false },
        { name: "live", isPublic: true },
      ])
    ).toThrow();
  });

  it("accepts a name of exactly the column's width", () => {
    // The boundary, in the direction that must NOT throw — otherwise the check
    // could be off by one and every test above would still pass.
    const exact = "x".repeat(MAX_STATE_NAME_LENGTH);
    expect(() =>
      ok([
        { name: exact, isPublic: false },
        { name: "live", isPublic: true },
      ])
    ).not.toThrow();
  });

  it("refuses two states of one name", () => {
    // Every question about that name becomes ambiguous — including whether it
    // is public, which is the one the read path asks.
    expect(() =>
      ok([
        { name: "draft", isPublic: false },
        { name: "draft", isPublic: true },
        { name: "live", isPublic: true },
      ])
    ).toThrow();
  });

  it("refuses a workflow with nothing public", () => {
    // It would fail silently: every public read simply returns nothing, on a
    // query that worked.
    expect(() =>
      ok([
        { name: "draft", isPublic: false },
        { name: "in_review", isPublic: false },
      ])
    ).toThrow();
  });

  it("refuses a workflow with no states at all", () => {
    expect(() => ok([])).toThrow();
  });

  it("refuses an empty state name", () => {
    expect(() =>
      ok([
        { name: "   ", isPublic: false },
        { name: "live", isPublic: true },
      ])
    ).toThrow();
  });
});

describe("the non-public complement", () => {
  const EDITORIAL_WITH_HOLD: ContentWorkflow = {
    name: "editorial",
    states: [
      { name: "draft", isPublic: false },
      { name: "in_review", isPublic: false },
      { name: "legal_hold", isPublic: false },
      { name: "live", isPublic: true },
    ],
  };

  it("covers EVERY state the workflow does not publish", () => {
    // What a `draft` read must mean under a custom workflow. Returning only
    // the state literally named `draft` would hide work in review from the
    // view whose whole job is to show unpublished work.
    expect(nonPublicStateNames(EDITORIAL_WITH_HOLD)).toEqual([
      "draft",
      "in_review",
      "legal_hold",
    ]);
  });

  it("partitions the workflow with the public set, leaving nothing out", () => {
    // The two together must be the whole vocabulary: a state in neither is one
    // no read can reach, and a state in both is one every read returns.
    const all = EDITORIAL_WITH_HOLD.states.map(state => state.name).sort();
    const partitioned = [
      ...publicStateNames(EDITORIAL_WITH_HOLD),
      ...nonPublicStateNames(EDITORIAL_WITH_HOLD),
    ].sort();
    expect(partitioned).toEqual(all);
  });

  it("is empty for a workflow whose every state is public", () => {
    // The control: without it the case above passes against a function that
    // returns every state regardless of the flag.
    expect(
      nonPublicStateNames({
        name: "always-live",
        states: [{ name: "live", isPublic: true }],
      })
    ).toEqual([]);
  });
});
