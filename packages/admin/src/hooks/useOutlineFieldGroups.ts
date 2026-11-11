"use client";

/**
 * The field groups a Builder outline shows beneath the fields that use them,
 * loaded as the field group's own editor loads them: one query per field
 * group, under the same key, so an edit there and the outline here read one
 * cached answer.
 *
 * A field group may itself use field groups, so the set to load grows as each
 * one arrives: every render reads the field groups already in the cache for
 * the slugs they name, and asks for those too. A field group that names one
 * already asked for adds nothing, so a cycle ends.
 */
import {
  useQueries,
  useQueryClient,
  type UseQueryOptions,
} from "@tanstack/react-query";
import { extractFieldGroupReferences } from "nextly/field-group-type";

import type { LoadedFieldGroup } from "@admin/lib/builder/outline/outline-model";
import { fieldGroupApi } from "@admin/services/fieldGroupApi";
import type { ApiFieldGroup } from "@admin/types/entities";

import { fieldGroupKeys } from "./queries/useFieldGroups";

/** Anything shaped like a field: a Builder field or a stored definition. */
interface FieldLike {
  fields?: readonly FieldLike[];
}

/** Every field-group slug named by these fields, at any depth, in order. */
function referencedSlugs(fields: readonly FieldLike[] | undefined): string[] {
  const slugs: string[] = [];
  const walk = (list: readonly FieldLike[]) => {
    for (const field of list) {
      const refs = extractFieldGroupReferences(field);
      if (refs.single !== undefined) slugs.push(refs.single);
      for (const slug of refs.many ?? []) slugs.push(slug);
      if (field.fields) walk(field.fields);
    }
  };
  walk(fields ?? []);
  return slugs;
}

export function useOutlineFieldGroups(
  fields: readonly FieldLike[]
): ReadonlyMap<string, LoadedFieldGroup> {
  const client = useQueryClient();

  // The slugs to ask for: those the entity names, then those each field group
  // already loaded names, until nothing new is named.
  const slugs: string[] = [];
  const pending = referencedSlugs(fields);
  while (pending.length > 0) {
    const slug = pending.shift() as string;
    if (slugs.includes(slug)) continue;
    slugs.push(slug);
    const loaded = client.getQueryData<ApiFieldGroup>(
      fieldGroupKeys.detail(slug)
    );
    pending.push(...referencedSlugs(loaded?.fields));
  }

  return useQueries({
    queries: slugs.map(
      (slug): UseQueryOptions<ApiFieldGroup, Error> => ({
        queryKey: fieldGroupKeys.detail(slug),
        queryFn: () => fieldGroupApi.get(slug),
      })
    ),
    combine: toLoadedFieldGroups,
  });
}

/**
 * The loaded field groups by slug. Defined once, outside the hook, so the
 * query library hands back the same map until a field group arrives or
 * changes, and the outline built from it is not rebuilt on every render.
 */
function toLoadedFieldGroups(
  results: readonly { data?: ApiFieldGroup }[]
): ReadonlyMap<string, LoadedFieldGroup> {
  const map = new Map<string, LoadedFieldGroup>();
  for (const { data } of results) {
    if (data) {
      map.set(data.slug, {
        slug: data.slug,
        label: data.label,
        fields: data.fields,
      });
    }
  }
  return map;
}
