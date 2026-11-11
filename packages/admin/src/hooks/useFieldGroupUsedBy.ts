"use client";

/**
 * Where a field group is used: each field that places it, and the
 * collection, Single or field group holding that field. What the field
 * group's own editor names as using it.
 *
 * Under the field group's own query key, so saving or deleting it, or any
 * field group, which refreshes those keys, refreshes this too.
 */
import type { ListResponse } from "@nextlyhq/ui";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import { protectedApi } from "@admin/lib/api/protectedApi";

import { fieldGroupKeys } from "./queries/useFieldGroups";

/** One field placing the field group, and what holds it. */
export interface FieldGroupPlacement {
  entityType: "collection" | "single" | "fieldGroup";
  entitySlug: string;
  /** The field's path from its entity's top level, dotted through containers. */
  fieldPath: string;
}

export function useFieldGroupUsedBy(
  slug: string | undefined
): UseQueryResult<FieldGroupPlacement[], Error> {
  return useQuery({
    queryKey: [...fieldGroupKeys.detail(slug ?? ""), "used-by"],
    queryFn: async () => {
      const result = await protectedApi.get<ListResponse<FieldGroupPlacement>>(
        `/field-groups/${encodeURIComponent(slug ?? "")}/used-by`
      );
      return result.items;
    },
    enabled: Boolean(slug),
  });
}
