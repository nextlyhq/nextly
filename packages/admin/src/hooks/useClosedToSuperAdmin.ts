"use client";

/**
 * The collections closed to super-admin, as the roles screen lists them, and
 * the change of one collection's mark, which the server accepts only with the
 * super-admin's password entered again.
 */

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
  type UseQueryResult,
} from "@tanstack/react-query";

import { toast } from "@admin/components/ui";
import type { ApiError } from "@admin/lib/api/parseApiError";
import { protectedApi } from "@admin/lib/api/protectedApi";
import {
  screenEntitiesFrom,
  type ScreenEntity,
} from "@admin/lib/permissions/level-rows";

/** The query the roles screen's collections are read through here. */
const SCREEN_KEY = ["roles-screen", "closed-to-super-admin"] as const;

/** A collection the roles screen lists, with its mark. */
export type MarkedCollection = ScreenEntity & {
  closedToSuperAdmin: NonNullable<ScreenEntity["closedToSuperAdmin"]>;
};

/** What a change of one collection's mark sends. */
export interface ClosedMarkChange {
  collection: string;
  closed: boolean;
  password: string;
}

/** A collection's name as the screen shows it. */
export function collectionName(collection: MarkedCollection): string {
  return collection.labels.plural ?? collection.labels.singular;
}

/** The collections, each with its mark, in the order the server lists them. */
function markedCollections(
  entities: readonly ScreenEntity[]
): MarkedCollection[] {
  return entities.filter(
    (entity): entity is MarkedCollection =>
      entity.kind === "collection" && entity.closedToSuperAdmin !== undefined
  );
}

/** Every collection with its closed-to-super-admin mark. */
export function useMarkedCollections(): UseQueryResult<MarkedCollection[]> {
  return useQuery({
    queryKey: SCREEN_KEY,
    queryFn: async () =>
      markedCollections(
        screenEntitiesFrom(await protectedApi.get<unknown>("/roles/screen"))
      ),
  });
}

/**
 * Changes one collection's mark, telling the user once it is saved and reading
 * the collections again; `onSaved` runs after that. A refusal is left on the
 * mutation's `error` for the dialog to show beside the password, where the
 * person can correct it, rather than in a toast that takes the focus away.
 */
export function useChangeClosedMark(
  onSaved: () => void
): UseMutationResult<unknown, Error, ClosedMarkChange> {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ClosedMarkChange) =>
      protectedApi.patch<unknown>("/roles/screen/closed-to-super-admin", input),
    onSuccess: async (_result, input) => {
      toast.success(
        input.closed
          ? "Collection closed to super-admins"
          : "Collection open to super-admins again",
        { description: "The change is recorded in the audit log." }
      );
      onSaved();
      await queryClient.invalidateQueries({ queryKey: SCREEN_KEY });
    },
  });
}

/**
 * The sentence a refused change shows beside the password. A wrong password
 * is said as such: the server's words are the sign-in form's, which name an
 * email no one typed here. Any other refusal (too many tries, say) in the
 * server's own words, else a plain fallback.
 */
export function refusalText(error: Error | null): string | null {
  if (error === null) return null;
  if ((error as ApiError).code === "AUTH_INVALID_CREDENTIALS") {
    return "That password isn't right. Try again.";
  }
  return error.message || "The change could not be saved. Try again.";
}

/**
 * The collections in the order the list shows them: closed ones first, then
 * the rest, each group by the name the admin shows.
 */
export function inListOrder(
  collections: readonly MarkedCollection[]
): MarkedCollection[] {
  return [...collections].sort((a, b) => {
    const closed =
      Number(b.closedToSuperAdmin.closed) - Number(a.closedToSuperAdmin.closed);
    return closed !== 0
      ? closed
      : collectionName(a).localeCompare(collectionName(b));
  });
}
