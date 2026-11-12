"use client";

/**
 * useBuilderFieldActions — the operations a schema-builder page performs on its
 * own field list, independent of which kind of entity it is editing.
 *
 * `useFieldBuilder` owns the field state; this owns the two decisions the
 * pages make about that state and had been making identically three times
 * over: where a duplicated field goes and what it is named, and which fields
 * count as the user's. What a drag means is the outline's, through the move
 * rule every way of moving a field asks.
 */
import { siblingNameClash } from "nextly/config";
import { useCallback } from "react";

import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";
import { toast } from "@admin/components/ui";
import {
  convertToFieldDefinition,
  findFieldById,
  findParentContainerId,
  SYSTEM_FIELD_NAMES,
} from "@admin/lib/builder";
import { isReservedFieldName } from "@admin/lib/builder/constants";
import { copyWithNewIds } from "@admin/lib/builder/copy-field";
import { freeDuplicateName } from "@admin/lib/builder/duplicate-field-name";
import { insertField, positionAfter } from "@admin/lib/builder/insert-field";
import type { MoveContext } from "@admin/lib/builder/move-rule";
import type { FieldDefinition } from "@admin/types/collection";

/** What naming a copy needs beyond the fields: the move rule's view of names. */
export type DuplicateNaming = Pick<
  MoveContext,
  "heldNames" | "topLevelReservesNames"
>;

export interface UseBuilderFieldActionsReturn {
  /**
   * Copy a field to right after itself, under the first name that clashes
   * with nothing beside it, by the server's own clash rule, and is not
   * reserved there.
   */
  handleDuplicateField: (fieldId: string, naming?: DuplicateNaming) => void;
  /**
   * The user's fields as field definitions, or null when they do not validate
   * — in which case the reason has already been shown as a toast.
   */
  getValidatedFields: () => FieldDefinition[] | null;
}

/**
 * Whether a copy may not be called `name` beside `siblings`: a sibling's name
 * clashes with it (the same, in other letter case, or the same column), a
 * pending delete there still holds one that does, or it is reserved there.
 */
function nameTaken(
  name: string,
  siblings: readonly BuilderField[],
  containerId: string | null,
  naming: DuplicateNaming | undefined
): boolean {
  const held = naming?.heldNames?.get(containerId ?? "") ?? [];
  return (
    siblings.some(sibling => siblingNameClash(name, sibling.name) !== null) ||
    held.some(other => siblingNameClash(name, other) !== null) ||
    (containerId === null &&
      naming?.topLevelReservesNames === true &&
      isReservedFieldName(name))
  );
}

export function useBuilderFieldActions(
  builder: BuilderFieldsApi
): UseBuilderFieldActionsReturn {
  const handleDuplicateField = useCallback(
    (fieldId: string, naming?: DuplicateNaming) => {
      const source = findFieldById(builder.fields, fieldId);
      if (!source) return;
      const containerId =
        findParentContainerId(builder.fields, fieldId)?.containerId ?? null;
      const siblings = containerId
        ? (findFieldById(builder.fields, containerId)?.fields ?? [])
        : builder.fields;
      // A new field all the way down: the copy and every field inside it get
      // new ids, so editing inside the copy never reaches the original.
      const duplicate: BuilderField = {
        ...copyWithNewIds(source),
        name: freeDuplicateName(source.name, name =>
          nameTaken(name, siblings, containerId, naming)
        ),
      };
      // Right after the original, read from its own container's list.
      const position = positionAfter(siblings, fieldId, containerId ?? undefined);
      if (!position) return;
      const next = insertField(builder.fields, duplicate, position);
      if (next) builder.setFields(next);
    },
    [builder]
  );

  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const userFields = builder.fields.filter(
      f => !f.isSystem && !SYSTEM_FIELD_NAMES.includes(f.name)
    );
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      // `errorMessage` is optional on the result, so a validator reporting
      // invalid without saying why would raise an empty toast — a refusal the
      // user cannot act on and cannot tell apart from a UI glitch.
      toast.error(validation.errorMessage || "Some fields are not valid yet.");
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  return { handleDuplicateField, getValidatedFields };
}
