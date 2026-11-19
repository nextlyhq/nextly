/**
 * What the settings screen reads off a workflow and its settings, without
 * rendering: a stage's primary step and the review stages as the server names
 * them, which permissions no role holds, who may be offered as a default
 * reviewer, which default reviewers the server says no longer hold their step,
 * and where a refused change lands.
 *
 * The plausible broken readings: a primary step taken from the steps' own
 * `primary` flag (missing a stage's only step), a notice per step rather than
 * per permission, reviewers offered from every role or from the grants alone (blind
 * to a role inheriting the step, or to a step needing the collections' own
 * permissions), a stale reviewer judged from the grants (blind to a
 * person, or to a deactivated one), and an issue path keyed in full so
 * `labels.x.colour` misses the label row.
 */
import { describe, expect, it } from "vitest";

import {
  assigneeKey,
  diagramSentences,
  issuesByField,
  primaryStepOf,
  reviewStages,
  reviewerOptions,
  staleReviewers,
  unheldPermissions,
} from "../workflow-settings-model";

import { EDITORIAL, ROLES, USERS, settingsOf } from "./fixtures";

describe("the workflow settings model", () => {
  it("takes a stage's primary step as the server names it, an only step out the code does not mark included", () => {
    // Cleared's only step (Bounce) is not marked primary in code; the server names it.
    expect(primaryStepOf(EDITORIAL, "cleared")?.name).toBe("bounce");
    expect(primaryStepOf(EDITORIAL, "legal")?.name).toBe("clear");
    expect(primaryStepOf(EDITORIAL, "hold")?.name).toBe("resume");
  });

  it("reads review stages as those with an approval out of them", () => {
    expect(reviewStages(EDITORIAL).map(stage => stage.name)).toEqual([
      "legal",
      "hold",
    ]);
  });

  it("names each permission no role holds once, with every step needing it", () => {
    const unheld = unheldPermissions(
      EDITORIAL,
      settingsOf({ grants: { clear: [], bounce: [] } })
    );
    expect(unheld).toEqual([
      {
        permission: "sign-off",
        steps: [
          expect.objectContaining({ name: "clear" }),
          expect.objectContaining({ name: "bounce" }),
        ],
      },
    ]);
    expect(unheldPermissions(EDITORIAL, settingsOf())).toEqual([]);
  });

  it("offers as a stage's reviewer the roles the server says hold its primary step, and the people having one", () => {
    const offered = (stage: string) =>
      reviewerOptions(settingsOf(), ROLES, USERS, stage).map(option =>
        assigneeKey(option.assignee)
      );
    expect(offered("legal")).toEqual([
      "role:r-admin",
      "role:r-lawyers",
      "user:u-rita",
      "user:u-ada",
    ]);
    // Resume needs only the collections' own update, which the server reads as for any step.
    expect(offered("hold")).toEqual([
      "role:r-admin",
      "role:r-editors",
      "user:u-ed",
      "user:u-ada",
    ]);
  });

  it("offers a role holding the step only through another, as the server lists it, and nobody for a stage it lists none for", () => {
    // Editors are granted nothing, but inherit sign-off: the grants alone would leave them out.
    const settings = settingsOf({
      reviewerRoles: { legal: ["r-lawyers", "r-editors"] },
    });
    expect(
      reviewerOptions(settings, ROLES, USERS, "legal").map(
        option => option.assignee.id
      )
    ).toEqual(["r-lawyers", "r-editors", "u-rita", "u-ed"]);
    expect(reviewerOptions(settings, ROLES, USERS, "hold")).toEqual([]);
  });

  it("says which default reviewers no longer hold their step, as the server answers it for a person or a role", () => {
    expect(
      staleReviewers(
        EDITORIAL,
        settingsOf({
          defaultReviewers: {
            legal: { kind: "user", id: "u-rita" },
            hold: { kind: "role", id: "r-editors" },
          },
          defaultReviewerHolds: { legal: "deactivated", hold: "holds" },
        })
      )
    ).toEqual([{ stage: "legal", answer: "deactivated" }]);
    expect(staleReviewers(EDITORIAL, settingsOf())).toEqual([]);
  });

  it("keys a refused change by the setting its path names, whatever part of it follows", () => {
    expect(
      issuesByField([
        { path: "labels.legal.colour", message: "A colour is a hex value." },
        { path: "defaultReviewers.legal", message: "Cannot review." },
        { path: "grants", message: "No role has the id `x`." },
      ])
    ).toEqual({
      "labels.legal": "A colour is a hex value.",
      "defaultReviewers.legal": "Cannot review.",
    });
  });

  it("tells the workflow as one sentence per stage, its documents, each step and where it leads, then where edits and publishes go", () => {
    const sentences = diagramSentences(
      EDITORIAL,
      stage => EDITORIAL.stages.find(each => each.name === stage)!.label
    );
    expect(sentences[1]).toBe(
      "Legal check, 2 documents: Clear moves it to Cleared; Bounce moves it to Writing, with a comment; Park moves it to On hold, with a comment."
    );
    expect(sentences[3]).toBe(
      "Cleared (may be published), 1 document: Bounce moves it to Writing, with a comment."
    );
    expect(sentences.slice(4)).toEqual([
      "An edit to approved content returns it to Legal check.",
      "Once published, the next draft starts at Writing.",
    ]);
  });
});
