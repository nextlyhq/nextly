/**
 * Whether an AI control may be drawn, from the server's AI status.
 *
 * Hidden unless the status says so: while it loads, when it failed, when AI
 * is not configured, when the person lacks the permission the control needs,
 * and, for a control that runs one task, when that task is not available to
 * them. Never shown on a guess: a button that appears and then refuses is
 * the thing this exists to prevent.
 *
 * @experimental With the AI contract.
 */
import type { AIPermissionKey, AIStatus } from "nextly/runtime";

/** What a control needs before it is drawn. */
export interface AIControlNeeds {
  /**
   * Which of the three AI permissions the control needs: `use` (the
   * default), `bulk` or `manage`.
   */
  permission?: AIPermissionKey;
  /** The task the control runs, when it runs one. */
  task?: { owner: string; name: string };
}

export function aiControlShown(
  status: AIStatus | undefined,
  needs: AIControlNeeds = {}
): boolean {
  if (status === undefined || !status.configured) return false;
  if (!status.permissions[needs.permission ?? "use"]) return false;
  const { task } = needs;
  if (task === undefined) return true;
  return status.tasks.some(
    t => t.owner === task.owner && t.name === task.name && t.available
  );
}
