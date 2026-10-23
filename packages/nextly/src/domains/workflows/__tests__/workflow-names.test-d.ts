/**
 * A workflow's stage and step names are exactly the ones it declares.
 *
 * Equality, not assignability: a definition whose names widened to `string`
 * would be assignable to any union, and is exactly what this must catch. The
 * refusals (a misspelt stage in a step) are in `compile-errors.test.ts`, which
 * names the error each one must produce. Compiled by `pnpm check-types`
 * through `tsconfig.tests.json`.
 */
import { expectTypeOf } from "vitest";

import { defineWorkflow } from "../define-workflow";
import { reviewWorkflow } from "../preset";
import type { WorkflowStageName, WorkflowStepName } from "../types";

const editorial = defineWorkflow({
  slug: "editorial",
  label: "Editorial",
  stages: [
    { name: "drafting", label: "Drafting" },
    { name: "inReview", label: "In review" },
    { name: "approved", label: "Approved", allowsPublish: true },
  ],
  steps: [
    {
      name: "submit",
      label: "Submit",
      kind: "submit",
      from: "drafting",
      to: "inReview",
    },
    {
      name: "approve",
      label: "Approve",
      kind: "approve",
      from: "inReview",
      to: "approved",
      primary: true,
    },
    {
      name: "back",
      label: "Back",
      kind: "request-changes",
      from: "inReview",
      to: "drafting",
    },
  ],
});

expectTypeOf<WorkflowStageName<typeof editorial>>().toEqualTypeOf<
  "drafting" | "inReview" | "approved"
>();
expectTypeOf<WorkflowStepName<typeof editorial>>().toEqualTypeOf<
  "submit" | "approve" | "back"
>();

// The preset names its own stages and steps the same way.
const preset = reviewWorkflow();
expectTypeOf<WorkflowStageName<typeof preset>>().toEqualTypeOf<
  "drafting" | "inReview" | "approved"
>();
expectTypeOf<WorkflowStepName<typeof preset>>().toEqualTypeOf<
  "submit" | "approve" | "requestChanges"
>();
