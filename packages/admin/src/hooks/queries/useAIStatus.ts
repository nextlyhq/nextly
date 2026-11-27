"use client";

/**
 * The AI status query: what every AI control asks before it is drawn.
 *
 * Fetched once per page and shared by every control on it through the query
 * cache, so a screen with many AI buttons asks once. Kept fresh for a minute:
 * turning AI on or off, or changing a role's model, shows on the next screen
 * a person opens rather than in the middle of one.
 *
 * @experimental With the AI contract.
 */
import type { UseQueryResult } from "@tanstack/react-query";
import { useQuery } from "@tanstack/react-query";
import type { AIRunTarget, AIStatus } from "nextly/runtime";

import { aiApi } from "@admin/services/aiApi";

/** How long a status is taken as current. */
const AI_STATUS_STALE_MS = 60_000;

const aiKeys = {
  all: () => ["ai"] as const,
  // One cached status per piece of content asked about, and one for none.
  status: (target?: AIRunTarget) =>
    [
      ...aiKeys.all(),
      "status",
      target?.collection ?? null,
      target?.id ?? null,
    ] as const,
};

/**
 * The AI status for the signed-in person, about one piece of content where
 * `target` names it.
 */
export function useAIStatus(
  target?: AIRunTarget
): UseQueryResult<AIStatus, Error> {
  return useQuery<AIStatus, Error>({
    queryKey: aiKeys.status(target),
    queryFn: () => aiApi.getAIStatus(target),
    staleTime: AI_STATUS_STALE_MS,
  });
}
