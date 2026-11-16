/**
 * What the server says of a collection or Single removed from code: its
 * registry row says the app's code defines it, and the configuration no
 * longer declares it. Its entries can still be read, and every write to them
 * is refused until it is retired or declared again.
 *
 * The server adds these fields only to a removed entity's listing and schema
 * reads; absent means not removed.
 *
 * @module types/removed-from-code
 */

/** Where a removed entity's retirement stands, from which its next step follows. */
export type RemovedFromCodeState =
  /** Its tables exist and no migration drops it. */
  | { state: "not-dropped" }
  /** A written migration drops it, not applied yet; its main table exists. */
  | { state: "drop-pending"; migration: string }
  /** An applied migration dropped its main table; its registry row remains. */
  | { state: "half-retired" }
  /** Any other state, for which no step is named here. */
  | { state: "other" };

/** The two fields a removed collection or Single carries. */
export interface RemovedFromCodeMark {
  /** True when the entity is removed from code. */
  removedFromCode?: boolean;
  /** Where its retirement stands, present when it is removed. */
  removedFromCodeState?: RemovedFromCodeState;
}
