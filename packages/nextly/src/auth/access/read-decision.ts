/**
 * The decision about reading a target, as the readers that answer it
 * themselves take it: population and the entity reader.
 *
 * Neither applies a rule's filter, so each needs the decision two ways. As
 * its own answer, a read the decision allows only for the entries a filter
 * matches is refused, the deviation it is. As the answer a deviation compares
 * today's with, the same read counts as allowed: "may the caller read the
 * collection" means yes, some entries.
 *
 * @module auth/access/read-decision
 */
import type { Actor } from "./actor";
import { decide, type AccessTarget } from "./decide";
import { allowedUnfiltered, allowsSome } from "./rule-answer";

/** The decision about reading `target`, for a deviation to compare with. */
export async function decidedRead(
  actor: Actor,
  target: AccessTarget
): Promise<boolean> {
  return allowsSome(await decide(actor, "read", target), "read");
}

/** The decision about reading `target`, as a reader that applies no filter answers it. */
export async function answeredRead(
  actor: Actor,
  target: AccessTarget
): Promise<boolean> {
  return allowedUnfiltered(await decide(actor, "read", target), "read");
}
