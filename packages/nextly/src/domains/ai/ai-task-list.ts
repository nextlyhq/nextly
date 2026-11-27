/**
 * The AI tasks this process knows, as core needs them: owner, name, role and
 * whether the result is written to the target.
 *
 * The seam the task registry fills at boot from what core, the AI package and
 * plugins register; until it does, the list is empty and every task named is
 * unknown. On globalThis, like the other boot registries, so the list a boot
 * recorded survives the module re-evaluation Next.js does.
 *
 * @module domains/ai/ai-task-list
 */
import type { AITaskRef } from "./ai-contract";

const globalForAITasks = globalThis as unknown as {
  __nextly_aiTasks?: readonly AITaskRef[];
};

/** Record the tasks this boot registered, replacing any earlier list. */
export function recordAITasks(tasks: readonly AITaskRef[]): void {
  globalForAITasks.__nextly_aiTasks = [...tasks];
}

/** The tasks the last boot recorded, or none. */
export function recordedAITasks(): readonly AITaskRef[] {
  return globalForAITasks.__nextly_aiTasks ?? [];
}
