/**
 * The decision about reading a target, as the readers that answer it
 * themselves take it: population and the entity reader.
 *
 * Each needs the decision two ways. As its own answer: population applies a
 * read rule's filter, so a read the decision allows only for the entries a
 * filter matches hands the filter back, and the entity reader, which applies
 * none, refuses it, the deviation it is. As the answer a deviation compares
 * today's with, the same read counts as allowed: "may the caller read the
 * collection" means yes, some entries.
 *
 * @module auth/access/read-decision
 */
import type { Actor } from "./actor";
import { decide, type AccessTarget } from "./decide";
import {
  allowedUnfiltered,
  allowsSome,
  filteredReadOf,
  type FilteredRead,
} from "./rule-answer";

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

/** The decision about reading `target`, as a reader that applies a read rule's filter answers it. */
export async function filteredRead(
  actor: Actor,
  target: AccessTarget
): Promise<FilteredRead> {
  return filteredReadOf(await decide(actor, "read", target), "read");
}
