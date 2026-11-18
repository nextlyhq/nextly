/**
 * What the settings screen reads off a workflow and its settings, without
 * rendering: a stage's primary step (its only step out, or the one marked),
 * the review stages, which permissions no role holds, who may be offered as a
 * default reviewer and whether a role reviewer still holds the step, and where
 * a refused change lands.
 *
 * The plausible broken readings: a primary step taken from the `primary` flag
 * alone (missing a stage's only step), a notice per step rather than per
 * permission, reviewers offered from every role, the super-admin role left out
 * of who holds a step, and an issue path keyed in full so `labels.x.colour`
 * misses the label row.
 */
import { describe, expect, it } from "vitest";

import {
  diagramSentences,
  issuesByField,
  primaryStepOf,
  reviewStages,
  reviewerOptions,
  reviewerStillHolds,
  unheldPermissions,
} from "../workflow-settings-model";

import { EDITORIAL, ROLES, USERS, settingsOf } from "./fixtures";

describe("the workflow settings model", () => {
  it("takes a stage's only step out as its primary step, or the one marked when there are several", () => {
    // Writing's only step is marked; Cleared's only step (Bounce) is not.
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

  it("offers as a stage's reviewer only roles and people holding its primary step, super admins included", () => {
    const offered = reviewerOptions(
      EDITORIAL,
      settingsOf(),
      ROLES,
      USERS,
      "legal"
    ).map(option => `${option.assignee.kind}:${option.assignee.id}`);
    expect(offered).toEqual([
      "role:r-admin",
      "role:r-lawyers",
      "user:u-rita",
      "user:u-ada",
    ]);
  });

  it("offers every assignable role and person where the grants cannot tell who holds the step", () => {
    // Resume needs only the collections' own permissions.
    const offered = reviewerOptions(
      EDITORIAL,
      settingsOf(),
      ROLES,
      USERS,
      "hold"
    ).map(option => option.assignee.id);
    expect(offered).toEqual([
      "r-admin",
      "r-lawyers",
      "r-interns",
      "r-editors",
      "u-rita",
      "u-ed",
      "u-ada",
    ]);
  });

  it("says a role reviewer no longer holds the step once it is not granted it, and cannot tell for a person", () => {
    const reviewing = (kind: "role" | "user", id: string) =>
      settingsOf({ defaultReviewers: { legal: { kind, id } } });
    expect(
      reviewerStillHolds(
        EDITORIAL,
        reviewing("role", "r-editors"),
        ROLES,
        "legal"
      )
    ).toBe(false);
    expect(
      reviewerStillHolds(
        EDITORIAL,
        reviewing("role", "r-lawyers"),
        ROLES,
        "legal"
      )
    ).toBe(true);
    expect(
      reviewerStillHolds(
        EDITORIAL,
        reviewing("role", "r-admin"),
        ROLES,
        "legal"
      )
    ).toBe(true);
    expect(
      reviewerStillHolds(EDITORIAL, reviewing("user", "u-ed"), ROLES, "legal")
    ).toBeNull();
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

  it("tells the workflow as one sentence per stage, each step and where it leads", () => {
    const sentences = diagramSentences(
      EDITORIAL,
      stage => EDITORIAL.stages.find(each => each.name === stage)!.label
    );
    expect(sentences[1]).toBe(
      "Legal check: Clear moves it to Cleared; Bounce moves it to Writing; Park moves it to On hold."
    );
    expect(sentences[3]).toBe(
      "Cleared (may be published): Bounce moves it to Writing."
    );
  });
});
