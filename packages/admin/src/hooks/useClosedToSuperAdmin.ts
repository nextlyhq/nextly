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
 * Changes one collection's mark, telling the user how it went and reading
 * the collections again once it is saved; `onSaved` runs after that.
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
        input.closed ? "Closed to super-admins" : "Open to super-admins again",
        { description: "The change is recorded in the audit log." }
      );
      onSaved();
      await queryClient.invalidateQueries({ queryKey: SCREEN_KEY });
    },
    onError: (error: Error) => {
      toast.error("Not changed", {
        description: error.message || "The change could not be saved.",
      });
    },
  });
}
