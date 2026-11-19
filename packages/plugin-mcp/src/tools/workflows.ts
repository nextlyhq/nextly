/**
 * The review tools, registered together on a server built for one caller.
 *
 * Three reads and one write. Nothing here approves, requests changes, publishes, skips review,
 * assigns or changes a workflow, and no tool takes an argument that would: `tools-list` and
 * `refused-approval` hold that over the server an agent actually reaches.
 *
 * @module tools/workflows
 */
import type { McpServer } from "@modelcontextprotocol/server";

import type { ToolCaller } from "./answer";
import { registerGetReviewState } from "./get-review-state";
import { registerGetWorkflow } from "./get-workflow";

/** Register every review tool, each closed over the caller the server was built for. */
export function registerWorkflowTools(
  server: McpServer,
  caller: ToolCaller
): void {
  registerGetWorkflow(server, caller);
  registerGetReviewState(server, caller);
}
