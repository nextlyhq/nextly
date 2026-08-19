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
import { arrayMove } from "@dnd-kit/sortable";
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
} from "@admin/lib/builder";
import { nextDuplicateName } from "@admin/lib/builder/duplicate-field-name";
import { packIntoRows, parseWidth } from "@admin/lib/builder/reflow";
import type { FieldDefinition } from "@admin/types/collection";

/**
 * Fields every builder kind provides itself. They are filtered out of the
 * definitions a save sends, so the server keeps owning them.
 */
const SYSTEM_FIELD_NAMES = ["title", "slug"];

/**
 * Whether a drag between two fields stays inside one container.
 *
 * Moving a field out of its group or repeater is deliberately not supported,
 * so a drag whose ends have different parents is a no-op rather than a move.
 */
function isSameContainerDrag(
  fields: BuilderField[],
  activeId: string,
  overId: string
): boolean {
  const activeParent = findParentContainerId(fields, activeId);
  const overParent = findParentContainerId(fields, overId);
  return Boolean(
    activeParent &&
      overParent &&
      activeParent.containerId === overParent.containerId
  );
}

/**
 * Apply a top-level move, which is expressed against ROWS rather than fields:
 * the field list packs fields into rows by width, so a row's new position has
 * to be applied to that layout and flattened back into a field order. System
 * fields are not packed and stay ahead of the result.
 *
 * Returns null when the ids are not row ids, which is every other drag.
 */
function reorderRows(
  fields: BuilderField[],
  activeId: string,
  overId: string
): BuilderField[] | null {
  if (!activeId.startsWith("row-") || !overId.startsWith("row-")) return null;
  const oldIdx = Number(activeId.slice("row-".length));
  const newIdx = Number(overId.slice("row-".length));
  if (Number.isNaN(oldIdx) || Number.isNaN(newIdx)) return null;

  const userFields = fields.filter(f => !f.isSystem);
  const systemFields = fields.filter(f => f.isSystem);
  const rows = packIntoRows(
    userFields.map(f => ({
      id: f.id,
      width: parseWidth(f.admin?.width),
      _field: f,
    }))
  );
  const reordered = arrayMove(rows, oldIdx, newIdx).flatMap(row =>
    row.map(r => (r as { _field: BuilderField })._field)
  );
  return [...systemFields, ...reordered];
}

export interface UseBuilderFieldActionsReturn {
  /** Clone a field beside itself, under the next free name. */
  handleDuplicateField: (fieldId: string) => void;
  /** Apply a drag from the field list. */
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
      const duplicate: BuilderField = {
        ...source,
        id: `field_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
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

  // The field list speaks two drag vocabularies: a nested child drags by field
  // id and sorts within its own container, while a top-level field drags by the
  // index of the row it was packed into.
  const handleRowDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id);
      const overId = String(over.id);

      if (activeId.startsWith("field_") && overId.startsWith("field_")) {
        if (isSameContainerDrag(builder.fields, activeId, overId)) {
          builder.setFields(prev =>
            reorderNestedFields(prev, activeId, overId)
          );
        }
        return;
      }

      const reordered = reorderRows(builder.fields, activeId, overId);
      if (reordered) builder.handleFieldsReorder(reordered);
    },
    [builder]
  );

  const getValidatedFields = useCallback((): FieldDefinition[] | null => {
    const userFields = builder.fields.filter(
      f => !f.isSystem && !SYSTEM_FIELD_NAMES.includes(f.name)
    );
    const validation = builder.validateFields(userFields);
    if (!validation.valid) {
      toast.error(validation.errorMessage);
      return null;
    }
    return userFields.map(convertToFieldDefinition);
  }, [builder]);

  return { handleDuplicateField, handleRowDragEnd, getValidatedFields };
}
