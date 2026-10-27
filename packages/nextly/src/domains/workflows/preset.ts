/**
 * The one-line preset for the common case: Drafting, In review, Approved.
 *
 * @module domains/workflows/preset
 * @experimental
 */

import { defineWorkflow } from "./define-workflow";
import type { Workflow } from "./types";

/** What the preset can be named; everything else is the preset's own. */
export interface ReviewWorkflowOptions {
  /** By default `review`. */
  slug?: string;
  /** By default "Review". */
  label?: string;
}

/**
 * Drafting → In review → Approved. A person submits a draft for review, and
 * a reviewer approves it, which allows publishing, or asks for changes, with
 * a comment, which sends it back to drafting. The person who submitted may
 * approve, so a team of one is never stuck. An edit to approved content sends
 * it back to review, and after publishing the next draft starts at drafting.
 *
 * @experimental
 */
export function reviewWorkflow(
  options: ReviewWorkflowOptions = {}
): Workflow<
  "drafting" | "inReview" | "approved",
  "submit" | "approve" | "requestChanges"
> {
  return defineWorkflow({
    slug: options.slug ?? "review",
    label: options.label ?? "Review",
    stages: [
      { name: "drafting", label: "Drafting" },
      { name: "inReview", label: "In review" },
      { name: "approved", label: "Approved", allowsPublish: true },
    ],
    steps: [
      {
        name: "submit",
        label: "Submit for review",
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
        permission: "approve",
        // The main action in review: what a reviewer is there to do.
        primary: true,
      },
      {
        name: "requestChanges",
        label: "Request changes",
        kind: "request-changes",
        from: ["inReview", "approved"],
        to: "drafting",
        permission: "approve",
      },
    ],
    onEdit: { to: "inReview" },
    afterPublish: "drafting",
  });
}
