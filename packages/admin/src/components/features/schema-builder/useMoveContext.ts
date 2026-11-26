"use client";

/**
 * What the move rule needs to know about the entity being edited, beyond its
 * fields: whether it is read-only, the kind of entity and whether its
 * Draft/Published is on (which the save's field-name rule asks of a name that
 * arrives somewhere new), the names its pending deletes still hold, the field groups it uses
 * with every place using each, and which field a field group's own row
 * stands for.
 */
import { useQueries } from "@tanstack/react-query";
import { useMemo } from "react";

import { fieldGroupUsedThroughQuery } from "@admin/hooks/useFieldGroupUsedBy";
import { nameSurfaceOf } from "@admin/lib/builder/field-name-check";
import {
  savedContainerIdsFrom,
  type MoveContext,
} from "@admin/lib/builder/move-rule";
import { heldNamesOf } from "@admin/lib/builder/move-words";
import { fieldGroupFieldHolding } from "@admin/lib/builder/outline/move-targets";
import {
  flattenOutline,
  type OutlineNode,
} from "@admin/lib/builder/outline/outline-model";

import { pickerExcludedTypes, type BuilderConfig } from "./builder-config";
import type { BuilderField } from "./types";

export function useMoveContext({
  config,
  locked,
  fields,
  saved,
  lifecycleEnabled,
  outline,
}: {
  config: BuilderConfig;
  locked: boolean;
  fields: readonly BuilderField[];
  /** The fields as last saved: where a pending delete still holds its name. */
  saved: readonly BuilderField[];
  /** Whether Draft/Published is on, as stored or as the pending settings set it. */
  lifecycleEnabled: boolean;
  outline: readonly OutlineNode[];
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
  // Every user of each, those reaching it through other field groups among them: the server walks
  // the nesting, so a refusal names a Single using the field group through another one too.
  const usedBy = useQueries({
    queries: used.map(slug => fieldGroupUsedThroughQuery(slug)),
  });
  const uses = new Map(
    used.map((slug, at) => [slug, usedBy[at]?.data] as const)
  );
  const heldNames = useMemo(() => heldNamesOf(saved, fields), [saved, fields]);
  // Where each field was last saved: a field never saved has no values a move
  // could lose, so it may leave repeating rows and change level freely.
  const savedContainerIdsOf = useMemo(
    () => savedContainerIdsFrom(saved),
    [saved]
  );

  return {
    entityReadOnly: locked,
    // A field group's fields sit inside whatever uses it, never beside an
    // entity's built-in columns; the rule knows each kind's.
    surface: nameSurfaceOf(config.kind),
    lifecycleEnabled,
    heldNames,
    savedContainerIdsOf,
    excludedTypes: pickerExcludedTypes(config),
    describeFieldGroup: slug => {
      if (!uses.has(slug)) return undefined;
      // Not read yet, or the read failed: the refusal says its users could not be read rather
      // than naming none.
      const answer = uses.get(slug);
      return answer
        ? { uses: answer.items, complete: answer.complete }
        : { uses: null, complete: false };
    },
    fieldGroupFieldHolding: rowId => fieldGroupFieldHolding(byId, rowId),
    fieldOfRow: rowId => byId.get(rowId)?.field,
  };
}
