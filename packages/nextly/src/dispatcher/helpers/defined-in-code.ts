/**
 * The refusal a schema route gives a collection, Single or component defined
 * in code: its schema changes by changing its code, and the caller is told so.
 *
 * @module dispatcher/helpers/defined-in-code
 */
import { NextlyError } from "../../errors/nextly-error";

/**
 * Refuse a schema change to `record` when it is defined in code (its
 * registry row is locked), naming the thing so the caller reads why. The
 * slug goes to the log.
 */
export function refuseChangeDefinedInCode(
  record: { locked?: boolean },
  thing: "collection" | "Single" | "component",
  slug: string
): void {
  if (!record.locked) return;
  throw NextlyError.definedInCode({
    thing,
    change: "change",
    logContext: { reason: `${thing.toLowerCase()}-locked`, slug },
  });
}
