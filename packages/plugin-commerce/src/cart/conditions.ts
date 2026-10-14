import { NextlyError } from "@nextlyhq/plugin-sdk";
import { and, type eq } from "@nextlyhq/plugin-sdk/db";

/** A query condition, as the SDK's operators build one. */
export type Condition = ReturnType<typeof eq>;

/**
 * Every one of `conditions`, as one condition.
 *
 * Drizzle types `and` as possibly answering nothing, because it also accepts
 * absent conditions; given only present ones it always answers. Should that
 * ever change, this refuses rather than dropping a condition, since a write
 * whose condition went missing would touch every row of the table.
 */
export function allOf(first: Condition, ...rest: Condition[]): Condition {
  const joined = and(first, ...rest);
  if (!joined) {
    throw NextlyError.internal({
      logContext: { reason: "a joined query condition came back empty" },
    });
  }
  return joined;
}
