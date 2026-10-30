/**
 * The collections the signed-in person last created entries of, from
 * `/api/dashboard/new-types`: up to three, the most recent first, each one they
 * may still create in. Recording a type puts it first, on the server, so the
 * New button reads the same on every device.
 *
 * @module hooks/queries/useDashboardNewTypes
 */
import {
  type UseQueryResult,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useCallback } from "react";

import { protectedApi } from "@admin/lib/api/protectedApi";

export const DASHBOARD_NEW_TYPES_KEY = ["dashboard", "new-types"] as const;

const PATH = "/dashboard/new-types";

/** The recent types' slugs, the most recent first. */
export function useDashboardNewTypes(): UseQueryResult<string[], Error> {
  return useQuery<string[], Error>({
    queryKey: DASHBOARD_NEW_TYPES_KEY,
    queryFn: async () =>
      (await protectedApi.get<{ items: { slug: string }[] }>(PATH)).items.map(
        item => item.slug
      ),
    staleTime: 60_000,
    retry: 1,
  });
}

/**
 * Records a type as the most recent, best effort: creating an entry never
 * waits for it, and a type that is not recorded only leaves New as it was.
 */
export function useRecordNewType(): (slug: string) => void {
  const client = useQueryClient();
  const { mutate } = useMutation({
    mutationFn: (slug: string) =>
      protectedApi.post<{ recent: string[] }>(PATH, { slug }),
    onSuccess: ({ recent }) =>
      client.setQueryData(DASHBOARD_NEW_TYPES_KEY, recent),
  });
  return useCallback((slug: string) => mutate(slug), [mutate]);
}
