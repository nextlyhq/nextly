"use client";

/**
 * Field Array Helpers
 *
 * Provides shared hooks and UI utilities for sortable field arrays (such as RepeatableComponent
 * in ComponentInput and RepeaterInput).
 *
 * @module components/entries/fields/structured/field-array-helpers
 */

import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type React from "react";
import { useCallback } from "react";

export interface UseSortableFieldArrayResult {
  /** Configured dnd-kit sensors (pointer + keyboard) */
  sensors: SensorDescriptor<SensorOptions>[];
  /** Drag-end callback handler that reorders items via the provided move function */
  handleDragEnd: (event: DragEndEvent) => void;
}

/**
 * Sets up drag-and-drop sensors and drag-end reordering handler for sortable field arrays.
 *
 * @param items - Array of field items containing unique `id` properties
 * @param move - Function from useFieldArray to move items between indices
 * @returns Sensors and drag end callback
 */
export function useSortableFieldArray<T extends { id: string }>(
  items: T[],
  move: (oldIndex: number, newIndex: number) => void
): UseSortableFieldArrayResult {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;

      if (over && active.id !== over.id) {
        const oldIndex = items.findIndex(item => item.id === active.id);
        const newIndex = items.findIndex(item => item.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          move(oldIndex, newIndex);
        }
      }
    },
    [items, move]
  );

  return { sensors, handleDragEnd };
}

export interface FieldArrayConstraintsParams {
  count: number;
  minRows?: number;
  maxRows?: number;
  isSortable?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
}

export interface FieldArrayConstraintsResult {
  canAdd: boolean;
  canRemove: boolean;
  isSortable: boolean;
}

/**
 * Computes interactive constraints for a repeatable field array (add, remove, sort).
 *
 * @param params - Constraint parameters including current count and field config
 * @returns Constraint flags
 */
export function getFieldArrayConstraints({
  count,
  minRows,
  maxRows,
  isSortable = true,
  disabled = false,
  readOnly = false,
}: FieldArrayConstraintsParams): FieldArrayConstraintsResult {
  const canAdd =
    !disabled && !readOnly && (maxRows === undefined || count < maxRows);
  const canRemove =
    !disabled && !readOnly && (minRows === undefined || count > minRows);
  const effectiveIsSortable = isSortable !== false;

  return {
    canAdd,
    canRemove,
    isSortable: effectiveIsSortable,
  };
}

export interface SortableFieldArrayContainerProps<T extends { id: string }> {
  items: T[];
  sensors: SensorDescriptor<SensorOptions>[];
  handleDragEnd: (event: DragEndEvent) => void;
  isSortable: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  children: React.ReactNode;
}

/**
 * Drag-and-drop container wrapping a sortable list of field items.
 */
export function SortableFieldArrayContainer<T extends { id: string }>({
  items,
  sensors,
  handleDragEnd,
  isSortable,
  disabled,
  readOnly,
  children,
}: SortableFieldArrayContainerProps<T>) {
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
    >
      <SortableContext
        items={items.map(item => item.id)}
        strategy={verticalListSortingStrategy}
        disabled={!isSortable || disabled || readOnly}
      >
        <div className="space-y-3">{children}</div>
      </SortableContext>
    </DndContext>
  );
}

export interface RowLimitNoticeProps {
  count: number;
  minRows?: number;
  maxRows?: number;
  label: string;
}

/**
 * Renders min-rows and max-rows status notices for a repeatable field array.
 */
export function RowLimitNotice({
  count,
  minRows,
  maxRows,
  label,
}: RowLimitNoticeProps) {
  const pluralLabel = label.toLowerCase();

  return (
    <>
      {minRows !== undefined && count < minRows && (
        <p className="text-sm text-warning-600 dark:text-warning-500">
          Minimum {minRows} {pluralLabel} required. Currently have {count}.
        </p>
      )}

      {maxRows !== undefined && count >= maxRows && (
        <p className="text-sm text-muted-foreground">
          Maximum {maxRows} {pluralLabel} reached.
        </p>
      )}
    </>
  );
}
