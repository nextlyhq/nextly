"use client";

/**
 * What the move rule needs to know about the entity being edited, beyond its
 * fields: whether it is read-only, whether its top level reserves built-in
 * names, the names its pending deletes still hold, the field groups it uses
 * with every place using each, and which field a field group's own row
 * stands for.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import {
  fieldGroupUsedByQuery,
  type FieldGroupPlacement,
} from "@admin/hooks/useFieldGroupUsedBy";
import type { MoveContext } from "@admin/lib/builder/move-rule";
import { heldNamesOf } from "@admin/lib/builder/move-words";
import { fieldGroupFieldHolding } from "@admin/lib/builder/outline/move-targets";
import {
  flattenOutline,
  type LoadedFieldGroup,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import { pickerExcludedTypes, type BuilderConfig } from "./builder-config";
import type { BuilderField } from "./types";

/** What each kind of holder is called in a sentence. */
const HOLDER_NOUNS: Record<FieldGroupPlacement["entityType"], string> = {
  collection: "the collection",
  single: "the Single",
  fieldGroup: "the field group",
};

/** Each holder a field group's placements name, once, in the order first met. */
function holders(placements: readonly FieldGroupPlacement[]): string[] {
  return [
    ...new Set(
      placements.map(
        each => `${HOLDER_NOUNS[each.entityType]} ${each.entitySlug}`
      )
    ),
  ];
}

export function useMoveContext({
  config,
  locked,
  fields,
  saved,
  outline,
  fieldGroups,
}: {
  config: BuilderConfig;
  locked: boolean;
  fields: readonly BuilderField[];
  /** The fields as last saved: where a pending delete still holds its name. */
  saved: readonly BuilderField[];
  outline: readonly OutlineNode[];
  fieldGroups: ReadonlyMap<string, LoadedFieldGroup>;
}): MoveContext {
  const byId = useMemo(
    () => new Map(flattenOutline(outline).map(node => [node.id, node])),
    [outline]
  );
  // Only the field groups this entity uses: a move can reach no other.
  const used = useMemo(
    () => [
      ...new Set(
        [...byId.values()].flatMap(node => node.fieldGroup?.slugs ?? [])
      ),
    ],
    [byId]
  );
  const usedBy = useQueries({
    queries: used.map(slug => fieldGroupUsedByQuery(slug)),
  });
  const placements = new Map(
    used.map((slug, at) => [slug, usedBy[at]?.data] as const)
  );
  const heldNames = useMemo(() => heldNamesOf(saved, fields), [saved, fields]);

  return {
    entityReadOnly: locked,
    // A field group's fields sit inside whatever uses it, never beside an
    // entity's built-in columns.
    topLevelReservesNames: config.kind !== "field-group",
    heldNames,
    excludedTypes: pickerExcludedTypes(config),
    describeFieldGroup: slug => {
      const loaded = fieldGroups.get(slug);
      const placed = placements.get(slug);
      if (!loaded && !placed) return undefined;
      return {
        label: loaded?.label ?? slug,
        usedBy: placed ? holders(placed) : [],
      };
    },
    fieldGroupFieldHolding: rowId => fieldGroupFieldHolding(byId, rowId),
  };
}
