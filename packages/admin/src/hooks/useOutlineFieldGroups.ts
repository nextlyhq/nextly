"use client";

/**
 * The field groups a Builder outline shows beneath the fields that use them,
 * read in one request: every field group's definition at once, whatever
 * fields name them and however deep, rather than one request per field group
 * and another round for each field group a loaded one uses.
 *
 * Under the field-group list's own key, so creating, saving or deleting a
 * field group, which refreshes that list, refreshes the outline too.
 */
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";

import type {
  FieldGroupsLoad,
  LoadedFieldGroup,
} from "@admin/lib/builder/outline/outline-model";
import { fieldGroupApi } from "@admin/services/fieldGroupApi";

import { fieldGroupKeys } from "./queries/useFieldGroups";

export function useOutlineFieldGroups(): {
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  load: FieldGroupsLoad;
} {
  const query = useQuery({
    queryKey: [...fieldGroupKeys.lists(), "every-definition"],
    queryFn: () => fieldGroupApi.list(),
  });
  const fieldGroups = useMemo(() => {
    const map = new Map<string, LoadedFieldGroup>();
    for (const group of query.data ?? []) {
      map.set(group.slug, {
        slug: group.slug,
        label: group.label,
        fields: group.fields,
      });
    }
    return map;
  }, [query.data]);
  // Failed only when nothing could be read: a refresh that fails while an
  // earlier answer is still in hand keeps showing that answer.
  const load: FieldGroupsLoad = query.data
    ? "loaded"
    : query.isError
      ? "failed"
      : "loading";
  return { fieldGroups, load };
}
