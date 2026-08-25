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
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Button } from "@nextlyhq/ui";
import { GripVertical, Trash2 } from "lucide-react";
import type React from "react";
import { useCallback, useState } from "react";

import { cn } from "@admin/lib/utils";

export interface RowDragHandleProps {
  isSortable: boolean;
  isInteractive: boolean;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  ariaLabel: string;
}

export function RowDragHandle({
  isSortable,
  isInteractive,
  attributes,
  listeners,
  ariaLabel,
}: RowDragHandleProps) {
  if (!isSortable || !isInteractive) {
    return <div className="w-6" />;
  }

  return (
    <button
      type="button"
      className={cn(
        "cursor-grab active:cursor-grabbing p-2 rounded-md",
        "focus:outline-none",
        "touch-none"
      )}
      aria-label={ariaLabel}
      {...attributes}
      {...listeners}
    >
      <GripVertical className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

export interface RowRemoveButtonProps {
  canRemove: boolean;
  isInteractive: boolean;
  onRemove?: () => void;
  ariaLabel: string;
}

export function RowRemoveButton({
  canRemove,
  isInteractive,
  onRemove,
  ariaLabel,
}: RowRemoveButtonProps) {
  if (!canRemove || !isInteractive) return null;

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      onClick={onRemove}
      className="h-8 w-8 shrink-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 mr-1"
      aria-label={ariaLabel}
    >
      <Trash2 className="h-4 w-4" />
    </Button>
  );
}

export interface UseSortableRowParams {
  id: string;
  initCollapsed?: boolean;
  disabled?: boolean;
  readOnly?: boolean;
  isSortable?: boolean;
}

export interface UseSortableRowResult {
  isOpen: boolean;
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>;
  attributes: ReturnType<typeof useSortable>["attributes"];
  listeners: ReturnType<typeof useSortable>["listeners"];
  setNodeRef: ReturnType<typeof useSortable>["setNodeRef"];
  transform: ReturnType<typeof useSortable>["transform"];
  transition: ReturnType<typeof useSortable>["transition"];
  isDragging: boolean;
  style: React.CSSProperties;
  isInteractive: boolean;
}

/**
 * Encapsulates sortable row state (collapsible expansion, dnd-kit sortable hook,
 * transform style generation, and interactivity check) for repeatable field rows.
 */
export function useSortableRow({
  id,
  initCollapsed = false,
  disabled = false,
  readOnly = false,
  isSortable = true,
}: UseSortableRowParams): UseSortableRowResult {
  const [isOpen, setIsOpen] = useState(!initCollapsed);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id,
    disabled: disabled || readOnly || !isSortable,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  const isInteractive = !disabled && !readOnly;

  return {
    isOpen,
    setIsOpen,
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
    style,
    isInteractive,
  };
}

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
