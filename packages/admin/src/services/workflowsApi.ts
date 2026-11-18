/**
 * The registered workflows and their settings, through `/workflows`.
 *
 * Reads answer the canonical shapes: the list `{ items, meta }`, the settings
 * the bare view. A change answers `{ message, item }`, and the settings as they
 * then read are its `item`, so the screen renders what the server stored.
 *
 * @module services/workflowsApi
 */

import { fetcher } from "../lib/api/fetcher";
import type { ListResponse, MutationResponse } from "../lib/api/response-types";
import type {
  WorkflowSettingsChange,
  WorkflowSettingsView,
  WorkflowSummary,
} from "../types/workflows";

/** The registered workflows, each with its stages, steps and attachments. */
export async function listWorkflows(): Promise<ListResponse<WorkflowSummary>> {
  return fetcher<ListResponse<WorkflowSummary>>(
    "/workflows",
    { cache: "no-store" },
    true
  );
}

/** One workflow's settings, as they read now. */
export async function getWorkflowSettings(
  slug: string
): Promise<WorkflowSettingsView> {
  return fetcher<WorkflowSettingsView>(
    `/workflows/${encodeURIComponent(slug)}/settings`,
    { cache: "no-store" },
    true
  );
}

/**
 * Changes a workflow's settings over the revision read, answering them as they
 * then read. A stale revision is refused with a conflict, and a part the server
 * cannot accept with a validation error naming its path.
 */
export async function updateWorkflowSettings(
  slug: string,
  change: WorkflowSettingsChange
): Promise<WorkflowSettingsView> {
  const result = await fetcher<MutationResponse<WorkflowSettingsView>>(
    `/workflows/${encodeURIComponent(slug)}/settings`,
    { method: "PATCH", body: JSON.stringify(change) },
    true
  );
  return result.item;
}
