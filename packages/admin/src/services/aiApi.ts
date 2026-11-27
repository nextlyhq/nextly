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
import type { AIRunTarget, AIStatus } from "nextly/runtime";

import { fetcher } from "../lib/api/fetcher";

/**
 * The AI status, as the server judges it for the signed-in person: about one
 * piece of content where `target` names it, so each task's availability
 * includes the person's right to read it and to edit it.
 */
function getAIStatus(target?: AIRunTarget): Promise<AIStatus> {
  const query = new URLSearchParams();
  if (target !== undefined) {
    query.set("collection", target.collection);
    if (target.id !== undefined) query.set("id", target.id);
  }
  const search = query.toString();
  return fetcher<AIStatus>(
    search === "" ? "/ai/status" : `/ai/status?${search}`,
    {},
    true
  );
}

export const aiApi: { getAIStatus: typeof getAIStatus } = { getAIStatus };
