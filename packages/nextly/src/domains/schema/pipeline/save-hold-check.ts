/**
 * A deleting save's hold of its collection, asked again before each statement the save sends.
 *
 * On MySQL a save's statements can run on other connections than the one holding the collection
 * (the push, the translations step, the file of a translated collection). A connection that is lost
 * ends its locks, and entry writes go ahead from then on, so what a later statement would drop was
 * counted under a hold that is gone: the save stops before it.
 *
 * Carried by the flow, as the schema lock's claim is (`assertSchemaLockHeld`), since none of what
 * sends the statements knows the save's hold. Outside such a save nothing is asked, and nothing
 * more is sent.
 *
 * @module domains/schema/pipeline/save-hold-check
 */
import { AsyncLocalStorage } from "node:async_hooks";

import { NextlyError } from "../../../errors/nextly-error";

/** Whether the hold of the save running in this flow is still kept, while such a save runs. */
const keptIn = new AsyncLocalStorage<() => Promise<boolean>>();

/** Why a save stopped before a statement: its hold was lost. */
const LOST = "save-hold-lost";

/** Runs `work`, each statement of which first asks `kept`; without one, `work` alone. */
export function withSaveHoldAsked<T>(
  kept: (() => Promise<boolean>) | undefined,
  work: () => Promise<T>
): Promise<T> {
  return kept === undefined ? work() : keptIn.run(kept, work);
}

/**
 * Asked before a statement is sent: stops a save whose hold is lost. A hold that cannot be shown
 * kept, its connection gone or not answering, is taken as lost.
 */
export async function assertSaveHoldKept(): Promise<void> {
  const kept = keptIn.getStore();
  if (kept === undefined) return;
  let cause: unknown;
  const stands = await kept().catch((error: unknown) => {
    cause = error;
    return false;
  });
  if (stands) return;
  throw new NextlyError({
    code: "COLLECTION_BEING_CHANGED",
    publicMessage:
      "This collection is being changed elsewhere. Try again in a moment.",
    logContext: { reason: LOST },
    ...(cause instanceof Error ? { cause } : {}),
  });
}

/** Whether `failure` is a save stopped before a statement for its lost hold: that one never ran. */
export function isSaveHoldLost(failure: unknown): boolean {
  return (
    NextlyError.isCode(failure, "COLLECTION_BEING_CHANGED") &&
    failure.logContext?.reason === LOST
  );
}
