"use client";

/**
 * The gate every AI control is drawn behind.
 *
 * ```tsx
 * <AIGate
 *   task={{ owner: "@nextlyhq/ai", name: "alt-text" }}
 *   target={{ collection: "media", id: image.id }}
 * >
 *   <Button>Write alt text</Button>
 * </AIGate>
 * ```
 *
 * A control that acts on content names it as `target`, so it is drawn only
 * where the person may read that content, and edit it where the task writes
 * its result: the same judgement the run will meet.
 *
 * Draws its children only once the server's AI status says AI is configured
 * and this person may use the control (`aiControlShown`). On a site without
 * an AI package nothing behind it is drawn, so no AI button appears anywhere.
 *
 * @experimental With the AI contract.
 */
import type { AIRunTarget } from "nextly/runtime";
import type { ReactNode } from "react";

import { useAIStatus } from "@admin/hooks/queries/useAIStatus";

import { aiControlShown, type AIControlNeeds } from "./ai-control-shown";

export type { AIControlNeeds } from "./ai-control-shown";

export interface AIGateProps extends AIControlNeeds {
  children: ReactNode;
  /** The content the control acts on, when it acts on some. */
  target?: AIRunTarget;
}

export function AIGate({ children, target, ...needs }: AIGateProps): ReactNode {
  const { data } = useAIStatus(target);
  return aiControlShown(data, needs) ? children : null;
}
