/**
 * Save the signed-in person's own name and avatar, through `PATCH /me`.
 *
 * `/me` writes only the caller's own row, and only these fields of it (with
 * the interface language, which the user menu saves), so it needs no
 * permission beyond being signed in. The signed-in user is read again after
 * the save, so the chrome's name and avatar follow at once.
 *
 * @module hooks/queries/useUpdateOwnProfile
 */
import {
  useMutation,
  useQueryClient,
  type UseMutationResult,
} from "@tanstack/react-query";

import { useApi } from "@admin/hooks/useApi";
import { currentUserKey } from "@admin/hooks/useDashboardUser";

/** What the account page changes of the person's own profile. */
export interface OwnProfileChanges {
  name: string;
  /** The avatar's URL; an empty string removes it. */
  image: string;
}

export function useUpdateOwnProfile(): UseMutationResult<
  unknown,
  Error,
  OwnProfileChanges
> {
  const { api } = useApi();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (changes: OwnProfileChanges) =>
      api.protected.patch("/me", changes),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: currentUserKey }),
  });
}
