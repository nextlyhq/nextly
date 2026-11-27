/**
 * AI API service.
 *
 * One read: whether AI is configured on this site, which model roles have a
 * model, which of the three AI permissions the signed-in person holds, and
 * which AI tasks they may run. Every AI control in the admin is drawn only
 * once this says so (`components/shared/ai-gate`). Nothing here reaches a
 * provider or a key: those stay on the server.
 *
 * @experimental With the AI contract.
 */
import type { AIStatus } from "nextly/runtime";

import { fetcher } from "../lib/api/fetcher";

/** The AI status, as the server judges it for the signed-in person. */
export function getAIStatus(): Promise<AIStatus> {
  return fetcher<AIStatus>("/ai/status", {}, true);
}

export const aiApi: { getAIStatus: typeof getAIStatus } = { getAIStatus };
