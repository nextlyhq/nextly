/**
 * Who trashed an item, as its record keeps them.
 *
 * A staff user or an API key is kept by its id and the name it had. A person
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
    case "apiKey":
      return {
        trashedByKind: actor.type,
        trashedById: actor.id ?? null,
        trashedByName: name,
      };
    case "principal":
      return {
        trashedByKind: "principal",
        trashedById: null,
        trashedByName: null,
      };
    default:
      return { trashedByKind: "system", trashedById: null, trashedByName: null };
  }
}
