"use client";

/**
 * Which collections and Singles a workflow may hold, as the server's workspace
 * answer says for this reader: what the review state and the waiting scope are
 * asked by, so neither is asked where no workflow can hold anything.
 *
 * Three answers, not a boolean:
 *
 * - `pending`: the workspace answer has not arrived; a read that depends on it
 *   waits for it. It arrives with the startup request, so this is short.
 * - `unknown`: the server did not say (the workspace half failed, or the server
 *   does not send `workflowEntities`); every read is asked, as it always was.
 * - a set of slugs: the server's answer.
 *
 * @module hooks/useWorkflowEntities
 * @experimental
 */

import {
  useBranding,
  useBrandingStatus,
} from "@admin/context/providers/BrandingProvider";

/** What the server says of the workflows that may hold this reader's content. */
export type WorkflowEntities = "pending" | "unknown" | ReadonlySet<string>;

export function useWorkflowEntities(): WorkflowEntities {
  const { workflowEntities } = useBranding();
  const { isPending, isUnavailable } = useBrandingStatus();
  // A failed workspace answer says nothing, even with an earlier one held.
  if (isUnavailable) return "unknown";
  if (workflowEntities !== undefined) return new Set(workflowEntities);
  return isPending ? "pending" : "unknown";
}

/**
 * Whether a read about workflows on `slug` (or on any collection or Single,
 * with no slug) should be asked: always where the server did not say, never
 * while its answer is on the way, and otherwise only where a workflow holds it.
 */
export function workflowMayHold(
  entities: WorkflowEntities,
  slug?: string
): boolean {
  if (entities === "unknown") return true;
  if (entities === "pending") return false;
  return slug === undefined ? entities.size > 0 : entities.has(slug);
}
