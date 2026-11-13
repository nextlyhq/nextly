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
import { useCallback } from "react";

import type {
  BuilderField,
  BuilderFieldsApi,
} from "@admin/components/features/schema-builder/types";
import { toast } from "@admin/components/ui";
import {
  convertToFieldDefinition,
  SYSTEM_FIELD_NAMES,
} from "@admin/lib/builder";
import {
  duplicatedFields,
  type DuplicateNaming,
} from "@admin/lib/builder/duplicate-field";
import { savedFieldsOffTheirLevel } from "@admin/lib/builder/move-rule";
import type { FieldDefinition } from "@admin/types/collection";

export interface UseBuilderFieldActionsReturn {
  /**
   * Copy a field to right after itself, under the first name that clashes
   * with nothing beside it, by the server's own clash rule, and is not
   * reserved there.
   */
  handleDuplicateField: (fieldId: string, naming?: DuplicateNaming) => void;
  /**
   * The user's fields as field definitions, or null when they do not validate
   * — in which case the reason has already been shown as a toast. Given the
   * fields as last saved, it also refuses a draft that takes a saved field to
   * another storage level, which the save would not yet keep the values of.
   */
  getValidatedFields: (
    saved?: readonly BuilderField[]
  ) => FieldDefinition[] | null;
}

export function useBuilderFieldActions(
  builder: BuilderFieldsApi
): UseBuilderFieldActionsReturn {
  const handleDuplicateField = useCallback(
    (fieldId: string, naming?: DuplicateNaming) => {
      const next = duplicatedFields(builder.fields, fieldId, naming);
      // One change, so one Undo takes the copy back.
      if (next) builder.setFields(next);
    },
    [builder]
  );

  const getValidatedFields = useCallback(
    (saved?: readonly BuilderField[]): FieldDefinition[] | null => {
      const userFields = builder.fields.filter(
        f => !f.isSystem && !SYSTEM_FIELD_NAMES.includes(f.name)
      );
      const validation = builder.validateFields(userFields);
      if (!validation.valid) {
        // `errorMessage` is optional on the result, so a validator reporting
        // invalid without saying why would raise an empty toast — a refusal the
        // user cannot act on and cannot tell apart from a UI glitch.
        toast.error(
          validation.errorMessage || "Some fields are not valid yet."
        );
        return null;
      }
      // The last gate before a save: a move the rule allowed (into a nameless
      // group) can become a change of level later in the same draft, when that
      // group is given a name. Judged here on the fields as they stand.
      const off = saved ? savedFieldsOffTheirLevel(saved, userFields) : [];
      if (off.length > 0) {
        const names = off.map(field => field.label || field.name).join(", ");
        toast.error(
          `${names} would move into or out of a group or repeating rows, which is not available yet: a save would not keep the values. Undo that change first.`
        );
        return null;
      }
      return userFields.map(convertToFieldDefinition);
    },
    [builder]
  );

  return { handleDuplicateField, getValidatedFields };
}
