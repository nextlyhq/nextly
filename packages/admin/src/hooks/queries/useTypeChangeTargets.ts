"use client";

/**
 * What each other type would do to a saved field's values, as the Schema Builder's type picker
 * shows it: asked of the server, which answers from the rules the save judges by
 * (`type-change-targets`).
 *
 * Keyed by the entity, the field as saved (its path and type) and the types asked about, so a save that
 * changes the field asks again; asked afresh each time the picker opens, since a save elsewhere can
 * change the saved definition. Not asked for a field that is not saved.
 */
import { useQuery, type UseQueryResult } from "@tanstack/react-query";

import type { BuilderKind } from "@admin/components/features/schema-builder/builder-config";
import {
  typeChangeTargetsAt,
  type TypeChangeQuestion,
  type TypeChangeTarget,
} from "@admin/services/typeChangeTargetsApi";

/** Where each kind's schema routes are. */
const SCHEMA_ADDRESS: Readonly<Record<BuilderKind, string>> = {
  collection: "/collections/schema",
  single: "/singles/schema",
  "field-group": "/field-groups/schema",
};

export function useTypeChangeTargets(args: {
  kind: BuilderKind;
  /** The entity's address; none for one not saved yet, whose fields are none of them saved. */
  slug: string | undefined;
  /** The saved field asked about, and the types the picker offers. Null for a field not saved. */
  question: TypeChangeQuestion | null;
}): UseQueryResult<TypeChangeTarget[]> {
  const { kind, slug, question } = args;
  return useQuery({
    queryKey: ["type-change-targets", kind, slug, question],
    queryFn: () => {
      // Asked only when there is a field saved at an address to ask about (`enabled`).
      if (slug === undefined || question === null) return Promise.resolve([]);
      return typeChangeTargetsAt(
        `${SCHEMA_ADDRESS[kind]}/${encodeURIComponent(slug)}`,
        question
      );
    },
    enabled: slug !== undefined && question !== null,
    staleTime: 0,
    gcTime: 0,
    // A refusal (the field no longer saved there) is the answer; asking again repeats it.
    retry: false,
  });
}
