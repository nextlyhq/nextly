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
