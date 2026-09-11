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
  type Announcements,
  type DataRef,
  type DragEndEvent,
  type SensorDescriptor,
  type SensorOptions,
  type UniqueIdentifier,
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
/**
 * The sensors every sortable surface in the admin drags with.
 *
 * Pointer AND keyboard, always together. A surface that builds its own
 * `useSensors` reaches for the pointer and stops, and the keyboard gap that
 * leaves is invisible to anyone testing with a mouse — two tables shipped that
 * way. One hook makes the pair the only thing there is to reach for.
 *
 * The 8px activation distance keeps a click on a row from starting a drag,
 * and `sortableKeyboardCoordinates` is what turns an arrow key into a move
 * to the neighbouring item rather than a move by a fixed number of pixels.
 */
export function useSortableSensors(): SensorDescriptor<SensorOptions>[] {
  return useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    })
  );
}

/**
 * One draggable or droppable as an announcement sees it: an id, and the data
 * its `useSortable`/`useDroppable` call attached. Both of dnd-kit's `Active`
 * and `Over` carry these, so one shape describes either end of a drag.
 */
export interface AnnouncedItem {
  id: UniqueIdentifier;
  data: DataRef;
}

/**
 * What a surface knows about the things it sorts.
 *
 * `describe` names an item — a field's label, a card's title. `place` says
 * where it sits, in words the surface owns: "position 2 of 5" for a list,
 * "column 1 of 3, position 2 of 4" for the grid. Either may answer
 * `undefined` for an id it does not know, and the sentence is built around
 * the gap rather than from it.
 */
export interface SortableAnnouncementModel {
  describe: (item: AnnouncedItem) => string | undefined;
  place?: (item: AnnouncedItem) => string | undefined;
}

/** The subject of a sentence when a surface cannot name an item. */
const UNNAMED = "the item";

/**
 * What a screen reader hears during a drag, said about the THING being moved.
 *
 * 🔴 dnd-kit's defaults read the draggable's ID aloud — "Picked up draggable
 * item 3f9a…" — and every sortable here is keyed by a field name, a placement
 * id or a uuid, so a reader moving a row by keyboard was told nothing they
 * could act on. The wording lives here ONCE so a field row and a dashboard
 * card are announced in the same sentences, and each surface supplies only
 * what it knows: a name for an id and, where it has one, the place it sits.
 *
 * `onDragEnd` names the landing. A surface that already announces its own
 * landing through a live region of its own overrides it to return
 * `undefined`, so a drop is not read twice — the dashboard grid does this,
 * because its button path speaks the same landing sentence and the two ways
 * of moving a card must sound the same.
 */
export function sortableAnnouncements(
  model: SortableAnnouncementModel
): Announcements {
  const name = (item: AnnouncedItem) => model.describe(item) ?? UNNAMED;
  const at = (item: AnnouncedItem) => model.place?.(item);
  const withPlace = (item: AnnouncedItem, sentence: string) => {
    const place = at(item);
    return place === undefined ? `${sentence}.` : `${sentence}, ${place}.`;
  };
  return {
    onDragStart: ({ active }) => withPlace(active, `Picked up ${name(active)}`),
    onDragOver: ({ active, over }) => {
      if (over === null) return `${name(active)} is no longer over a list.`;
      // The first thing a picked-up item is over is ITSELF, and dnd-kit reports
      // that as a hover like any other. Said aloud it would overwrite the
      // pick-up sentence with "Slug is over Slug" -- so it is not said, and
      // the pick-up stands until the item reaches something else.
      if (over.id === active.id) return undefined;
      return withPlace(over, `${name(active)} is over ${name(over)}`);
    },
    onDragEnd: ({ active, over }) => {
      if (over === null) return `${name(active)} was dropped. Nothing moved.`;
      // Dropped where it was picked up -- Space twice with no arrow, or a
      // pointer released over the original row. Every handler skips the
      // reorder for this, so saying "moved to" here confirmed a move that
      // did not happen.
      if (over.id === active.id) {
        return `${name(active)} was dropped where it was. Nothing moved.`;
      }
      return `${name(active)} moved to ${at(over) ?? name(over)}.`;
    },
    onDragCancel: ({ active }) => {
      const place = at(active);
      return place === undefined
        ? `Dragging cancelled. ${name(active)} is where it was.`
        : `Dragging cancelled. ${name(active)} returned to ${place}.`;
    },
  };
}

/**
 * Where an id sits in a single ordered list, as a phrase.
 *
 * The `place` a flat sortable list hands to {@link sortableAnnouncements}.
 * One-based, because a reader is told "position 1 of 5" and not "index 0".
 */
export function positionInList(
  ids: readonly UniqueIdentifier[],
  id: UniqueIdentifier
): string | undefined {
  const index = ids.indexOf(id);
  return index === -1 ? undefined : `position ${index + 1} of ${ids.length}`;
}

export function useSortableFieldArray<T extends { id: string }>(
  items: T[],
  move: (oldIndex: number, newIndex: number) => void
): UseSortableFieldArrayResult {
  const sensors = useSortableSensors();

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
  /**
   * What one row is called when a drag announces it, singular: "Gallery
   * item", "Author". Rows in a repeater carry no label of their own, so the
   * field's is borrowed and numbered -- "Picked up Gallery item 2, position
   * 2 of 4". Absent, a row is "Item".
   */
  itemLabel?: string;
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
  itemLabel = "Item",
  children,
}: SortableFieldArrayContainerProps<T>) {
  const ids = items.map(item => item.id);
  const announcements = sortableAnnouncements({
    describe: ({ id }) => {
      const index = ids.indexOf(String(id));
      return index === -1 ? undefined : `${itemLabel} ${index + 1}`;
    },
    place: ({ id }) => positionInList(ids, id),
  });
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={handleDragEnd}
      accessibility={{ announcements }}
    >
      <SortableContext
        items={ids}
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
