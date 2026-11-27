"use client";

/**
 * The gate every AI control is drawn behind.
 *
 * ```tsx
 * <AIGate task={{ owner: "@nextlyhq/ai", name: "alt-text" }}>
 *   <Button>Write alt text</Button>
 * </AIGate>
 * ```
 *
 * Draws its children only once the server's AI status says AI is configured
 * and this person may use the control (`aiControlShown`). On a site without
 * an AI package nothing behind it is drawn, so no AI button appears anywhere.
 *
 * @experimental With the AI contract.
 */
import type { ReactNode } from "react";

import { useAIStatus } from "@admin/hooks/queries/useAIStatus";

import { aiControlShown, type AIControlNeeds } from "./ai-control-shown";

export type { AIControlNeeds } from "./ai-control-shown";

export interface AIGateProps extends AIControlNeeds {
  children: ReactNode;
}

export function AIGate({ children, ...needs }: AIGateProps): ReactNode {
  const { data } = useAIStatus();
  return aiControlShown(data, needs) ? children : null;
}
