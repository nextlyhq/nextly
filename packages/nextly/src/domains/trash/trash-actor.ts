/**
 * Who trashed an item, as its record keeps them.
 *
 * A staff user is kept by their id and the name they had; an API key by its
 * id alone. A person
 * a plugin defines is kept by their kind of person alone: their id is
 * erased with them elsewhere, and the trash keeps no copy that erasure would
 * miss. Trusted server work is `system`.
 *
 * @module domains/trash/trash-actor
 */
import type { RequestActor } from "../../auth/request-actor";

/** The record's three columns naming who trashed the item. */
export interface TrashActorColumns {
  trashedByKind: string;
  trashedById: string | null;
  trashedByName: string | null;
}

export function trashActorColumns(
  actor: RequestActor,
  name: string | null
): TrashActorColumns {
  switch (actor.type) {
    case "user":
      return {
        trashedByKind: "user",
        trashedById: actor.id ?? null,
        trashedByName: name,
      };
    case "apiKey":
      // The name a delete is handed is the key owner's, not the key's: a key
      // is named by its id alone, never as the person who made it.
      return {
        trashedByKind: "apiKey",
        trashedById: actor.id ?? null,
        trashedByName: null,
      };
    case "principal":
      return {
        trashedByKind: "principal",
        trashedById: null,
        trashedByName: null,
      };
    default:
      return {
        trashedByKind: "system",
        trashedById: null,
        trashedByName: null,
      };
  }
}
