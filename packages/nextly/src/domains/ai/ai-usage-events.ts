/**
 * The usage-event hook: listeners inside the site's own process that hear
 * about every AI run when it ends.
 *
 * Kept on globalThis, like the other boot registries, so a listener added at
 * start-up survives the module re-evaluation Next.js does. Nothing here leaves
 * the process: a listener is code the site or one of its packages registered.
 *
 * @module domains/ai/ai-usage-events
 */
import { consoleLogger } from "../../shared/types";

import type { AIUsageEvent, AIUsageListener } from "./ai-contract";

const globalForAIUsage = globalThis as unknown as {
  __nextly_aiUsageListeners?: Set<AIUsageListener>;
};

function listeners(): Set<AIUsageListener> {
  globalForAIUsage.__nextly_aiUsageListeners ??= new Set();
  return globalForAIUsage.__nextly_aiUsageListeners;
}

/**
 * Hear every AI run's usage event. Returns the function that stops it.
 * The same listener added twice hears each event once.
 */
export function onAIUsage(listener: AIUsageListener): () => void {
  listeners().add(listener);
  return () => {
    listeners().delete(listener);
  };
}

/**
 * Tell every listener about one run. Each is called and awaited apart from
 * the others, so one that throws or rejects is logged and the rest still hear
 * it; the run's own result never depends on a listener.
 */
export async function emitAIUsage(event: AIUsageEvent): Promise<void> {
  const settled = await Promise.allSettled(
    [...listeners()].map(async listener => listener(event))
  );
  for (const outcome of settled) {
    if (outcome.status === "rejected") {
      consoleLogger.error("An AI usage listener failed; the run stands.", {
        task: event.task,
        result: event.result,
        error: outcome.reason,
      });
    }
  }
}
