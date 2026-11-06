/**
 * When each dashboard load's layout read handed its load over: the moment it
 * had judged every card that hides while empty, so its answer was ready to
 * return. What it answered ahead for the load (Needs attention's digest)
 * waits for the load's batch from that moment, not from when it was read: the
 * layout read waits for its slowest card, up to that card's slot budget, and a
 * window counted from an earlier answer could close before the batch was even
 * able to ask.
 *
 * Held for the process (`processHeld`), as what is read ahead is: the layout
 * read and the batch can reach different copies of this module.
 *
 * @module domains/widgets/read-ahead-handover
 */

import { processHeld } from "./process-held";

/** How long a load's read-ahead waits for its batch once the load is handed over. */
const KEPT_MS = 5_000;

/** At most this many loads are remembered at once; the earliest handed over goes first. */
const LOADS = 500;

/** When each load was handed over, by its token, the earliest at the front. */
const handedOver = processHeld(
  "nextly.dashboard.readAheadHandedOver",
  () => new Map<string, number>(),
  (held): held is Map<string, number> => held instanceof Map
);

/**
 * Marks the load `token` names as handed over now: its layout read has judged
 * every card, and what it read ahead may be taken by the load's batch from
 * here, for {@link KEPT_MS}.
 */
export function handOverReadAhead(token: string): void {
  // Deleted first, so a load handed over again is kept at the back, as the latest.
  handedOver.delete(token);
  handedOver.set(token, Date.now());
  for (const earliest of handedOver.keys()) {
    if (handedOver.size <= LOADS) break;
    handedOver.delete(earliest);
  }
}

/**
 * Where the load `token` names stands: `"pending"` while its layout read has
 * not handed it over (or it is no longer remembered), when nothing read ahead
 * for it may be taken yet but it is not spent either; `"open"` for
 * {@link KEPT_MS} from the handover, when its batch may take what was read
 * ahead; and `"closed"` after that, when nothing read ahead for it will be
 * taken.
 */
export function readAheadState(token: string): "pending" | "open" | "closed" {
  const at = handedOver.get(token);
  if (at === undefined) return "pending";
  return Date.now() - at < KEPT_MS ? "open" : "closed";
}
