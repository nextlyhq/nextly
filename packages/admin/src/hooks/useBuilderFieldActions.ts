"use client";

/**
 * useBuilderFieldActions — the operations a schema-builder page performs on its
 * own field list, independent of which kind of entity it is editing.
 *
 * `useFieldBuilder` owns the field state; this owns the three decisions the
 * pages make about that state and had been making identically three times
 * over: what a duplicated field is named, what a drag means, and which fields
 * count as the user's.
 */
import type { DragEndEvent } from "@dnd-kit/core";
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
  reorderNestedFields,
  SYSTEM_FIELD_NAMES,
} from "@admin/lib/builder";
import { builderDropAccepted } from "@admin/lib/builder/builder-rows";
import { copyWithNewIds } from "@admin/lib/builder/copy-field";
import { nextDuplicateName } from "@admin/lib/builder/duplicate-field-name";
import type { FieldDefinition } from "@admin/types/collection";

export interface UseBuilderFieldActionsReturn {
  /** Clone a field beside itself, under the next free name. */
  handleDuplicateField: (fieldId: string) => void;
  /** Apply a drag from the outline: a field moving within its container. */
  handleRowDragEnd: (event: DragEndEvent) => void;
  /**
   * The user's fields as field definitions, or null when they do not validate
   * — in which case the reason has already been shown as a toast.
   */
  getValidatedFields: () => FieldDefinition[] | null;
}

export function useBuilderFieldActions(
  builder: BuilderFieldsApi
): UseBuilderFieldActionsReturn {
  const handleDuplicateField = useCallback(
    (fieldId: string) => {
      // Duplicate is reachable from nested rows as well as top-level ones, so
      // locate the source and its container first. `takenNames` is the sibling
      // list rather than every field, which lets a nested field and a
      // top-level one carry the same name.
      const source = findFieldById(builder.fields, fieldId);
      if (!source) return;
      const parent = findParentContainerId(builder.fields, fieldId);
      const siblings = parent
        ? (findFieldById(builder.fields, parent.containerId)?.fields ?? [])
        : builder.fields;
      const takenNames = siblings.map(f => f.name);
      // A new field all the way down: the copy and every field inside it get
      // new ids, so editing inside the copy never reaches the original.
      const duplicate: BuilderField = {
        ...copyWithNewIds(source),
        name: nextDuplicateName(source.name, takenNames),
      };
      if (parent) {
        builder.handleNestedFieldAdd(parent.containerId, duplicate);
      } else {
        builder.setFields([...builder.fields, duplicate]);
      }
    },
    [builder]
  );

  // A field drags by its own id and moves among its siblings, at any depth.
  const handleRowDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;
      const activeId = String(active.id);
      const overId = String(over.id);
      // The ONE acceptance rule, shared with the drag announcements so what
      // the reader is told matches what happens: a refused drop is refused
      // here and described as unchanged there.
      if (!builderDropAccepted(builder.fields, activeId, overId)) return;
      builder.setFields(prev => reorderNestedFields(prev, activeId, overId));
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

  return { handleDuplicateField, handleRowDragEnd, getValidatedFields };
}
