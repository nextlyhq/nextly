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
  /**
   * For a holder reaching the field group through other field groups, those field groups, holder
   * side first; absent for a direct use. Only the read through field groups gives it.
   */
  via?: string[];
}

/**
 * Every collection, Single and field group using a field group, directly or through other field
 * groups, and whether the reader may read every one of them: `complete` is false where the
 * reader's scope hides a collection or Single, so a list without them is not taken for the whole.
 */
export interface FieldGroupUses {
  items: FieldGroupPlacement[];
  complete: boolean;
}

/** The used-by answer read through field groups: its list, and the meta saying whether it is whole. */
interface UsedThroughResponse {
  items: FieldGroupPlacement[];
  meta?: { complete?: unknown };
}

/**
 * The query reading every user of a field group, those reaching it through other field groups
 * among them (`?through=field-groups`): what a refused move names. Under its own key beside the
 * direct read, so the field group editor's list and this answer never stand in for each other,
 * and under the field group's detail key, so the saves that refresh one refresh both.
 */
export function fieldGroupUsedThroughQuery(slug: string | undefined) {
  return {
    queryKey: [...fieldGroupKeys.detail(slug ?? ""), "used-by", "through"],
    queryFn: async (): Promise<FieldGroupUses> => {
      const result = await protectedApi.get<UsedThroughResponse>(
        `/field-groups/${encodeURIComponent(slug ?? "")}/used-by?through=field-groups`
      );
      // Whole unless the server says a user was hidden: an answer saying nothing of it is the
      // server's whole list, as the direct read always was.
      return { items: result.items, complete: result.meta?.complete !== false };
    },
    enabled: Boolean(slug),
    // Read afresh, as the direct read is: a save placing the field group elsewhere refreshes its
    // own entity's keys, not this one.
    staleTime: 0,
    gcTime: 0,
  };
}

/**
 * The query reading where a field group is used, for one slug: what
 * `useFieldGroupUsedBy` reads for the field group's own editor.
 */
function fieldGroupUsedByQuery(slug: string | undefined) {
  return {
    queryKey: [...fieldGroupKeys.detail(slug ?? ""), "used-by"],
    queryFn: async () => {
      const result = await protectedApi.get<ListResponse<FieldGroupPlacement>>(
        `/field-groups/${encodeURIComponent(slug ?? "")}/used-by`
      );
      return result.items;
    },
    enabled: Boolean(slug),
    // Read afresh each time the editor opens, and kept no longer. A save to a
    // collection or Single that places the field group refreshes their own
    // keys, not this one, so an answer kept from an earlier visit could name
    // the old holders, or none.
    staleTime: 0,
    gcTime: 0,
  };
}

export function useFieldGroupUsedBy(
  slug: string | undefined
): UseQueryResult<FieldGroupPlacement[], Error> {
  return useQuery(fieldGroupUsedByQuery(slug));
}
