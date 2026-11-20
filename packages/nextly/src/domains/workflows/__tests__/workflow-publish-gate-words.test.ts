/**
 * The words the publish gate refuses a part with: a language is one ("is", "has"), the shared
 * fields are many ("are", "have"). Read from `holdReason`, the one per-part decision a publish and
 * a release refuse with.
 */
import { describe, expect, it } from "vitest";

import { defineWorkflow } from "../define-workflow";
import { workflowDefinitionHash } from "../hash";
import type { RegisteredWorkflow } from "../registry";
import type { ReviewState } from "../review-state-repository";
import { holdReason } from "../workflow-publish-gate";

const gated = defineWorkflow({
  slug: "gated",
  label: "Gated",
  stages: [
    { name: "draft", label: "Draft" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  steps: [
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "draft",
      to: "approved",
      primary: true,
    },
  ],
});

const registered: RegisteredWorkflow = {
  workflow: gated,
  definitionHash: workflowDefinitionHash(gated),
  configPath: null,
  collections: ["posts"],
  singles: [],
};

/** A part standing in Approved with no approval held. */
function approvedWithout(part: string | null): ReviewState {
  return {
    scopeKind: "collection",
    scopeSlug: "posts",
    entryId: "p1",
    part,
    stage: "approved",
    enteredAt: new Date("2026-11-19T09:00:00Z"),
    enteredBy: null,
    assignee: null,
    dueAt: null,
    approval: null,
    definitionHash: registered.definitionHash,
    revision: 1,
  };
}

const notLive = { live: false, pending: true };

describe("the publish gate's refusal words", () => {
  it("says the shared fields are in a stage, and have no approval", () => {
    expect(holdReason(registered, null, null, notLive, undefined)).toBe(
      'The shared fields are in "Draft", which does not allow publishing.'
    );
    expect(
      holdReason(registered, null, approvedWithout(null), notLive, undefined)
    ).toBe("The shared fields have no current approval.");
  });

  it("says a language is in a stage, and has no approval", () => {
    expect(holdReason(registered, "es", null, notLive, undefined)).toBe(
      'The "es" language is in "Draft", which does not allow publishing.'
    );
    expect(
      holdReason(registered, "es", approvedWithout("es"), notLive, undefined)
    ).toBe('The "es" language has no current approval.');
  });
});
