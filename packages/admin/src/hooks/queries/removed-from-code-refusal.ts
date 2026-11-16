/**
 * The server's refusal of a write to a collection or Single removed from code.
 *
 * Every such write is answered with 409 `ENTITY_REMOVED_FROM_CODE`, a sentence
 * that names the entity, says it was removed from code and gives both ways
 * out, and `data: { kind, slug }`. Each write hook reads it through here, so
 * the sentence reaches the author as the server wrote it and the screen that
 * sent the write learns the entity is now read-only.
 *
 * @module hooks/queries/removed-from-code-refusal
 */

import type { QueryClient } from "@tanstack/react-query";

import { isApiError } from "@admin/lib/api/parseApiError";

const REMOVED_FROM_CODE = "ENTITY_REMOVED_FROM_CODE";

/**
 * The root keys of the collection and Single queries, every schema read among
 * them. Spelled here rather than imported from `useCollections` and
 * `useSingles`, because `useSingles` imports this module; the test pins them
 * against both factories.
 */
const COLLECTIONS_ROOT = ["collections"] as const;
const SINGLES_ROOT = ["singles"] as const;

/**
 * The server's sentence when `error` is its refusal of a write to an entity
 * removed from code, and null for any other failure, a request that never
 * reached the server included.
 */
export function removedFromCodeRefusal(error: unknown): string | null {
  if (!isApiError(error)) return null;
  if (error.status !== 409 || error.code !== REMOVED_FROM_CODE) return null;
  return error.message;
}

/**
 * Read the refused entity's schema again, with its listing, when `error` is
 * that refusal. A screen opened before the removal still holds a schema that
 * says the entity may be edited; the schema read again carries the mark, so
 * the screen turns read-only and shows its notice, and the navigation marks
 * it. Answers whether it was that refusal.
 */
export function refreshRemovedFromCodeSchema(
  queryClient: QueryClient,
  error: unknown
): boolean {
  if (removedFromCodeRefusal(error) === null) return false;
  const kind = isApiError(error) ? error.data?.kind : undefined;
  if (kind !== "single") {
    void queryClient.invalidateQueries({ queryKey: COLLECTIONS_ROOT });
  }
  if (kind !== "collection") {
    void queryClient.invalidateQueries({ queryKey: SINGLES_ROOT });
  }
  return true;
}
