"use client";

/**
 * The field groups a Builder outline shows beneath the fields that use them,
 * read as one list: every field group's definition, whatever fields name them
 * and however deep, rather than one request per field group and another round
 * for each field group a loaded one uses. The list is read to its last page,
 * so a field group past the first page is not taken for a missing one.
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
import type { ApiFieldGroup } from "@admin/types/entities";

import { fieldGroupKeys } from "./queries/useFieldGroups";

/** Field groups asked for per request: one request on most sites. */
const PAGE_SIZE = 100;

/** Every field group, page by page until the list says there is no more. */
async function readEveryFieldGroup(): Promise<ApiFieldGroup[]> {
  const every: ApiFieldGroup[] = [];
  for (let page = 0; ; page += 1) {
    const { items, meta } = await fieldGroupApi.fetchComponents({
      pagination: { page, pageSize: PAGE_SIZE },
    });
    every.push(...items);
    // An empty page ends it too, so a list that misreports its pages
    // cannot keep the outline asking.
    if (!meta.hasNext || items.length === 0) return every;
  }
}

export function useOutlineFieldGroups(): {
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
  load: FieldGroupsLoad;
} {
  const query = useQuery({
    queryKey: [...fieldGroupKeys.lists(), "every-definition"],
    queryFn: readEveryFieldGroup,
  });
  const fieldGroups = useMemo(() => {
    const map = new Map<string, LoadedFieldGroup>();
    for (const group of query.data ?? []) {
      map.set(group.slug, {
        slug: group.slug,
        label: group.label,
        fields: group.fields,
        // The list answers with each field group's use count; null when it
        // could not be read, which the outline then leaves unsaid.
        placedBy: group.placedBy ?? null,
        // Whether the field group translates its fields. The server sends it
        // on every record; the record's type does not name it, so it is read
        // through a check that holds whatever arrives.
        localized: "localized" in group && group.localized === true,
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
