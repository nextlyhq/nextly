"use client";

/**
 * The tree itself: the rows to draw, with the places a field can be added
 * among them, inside the drag context. Every row makes way while a field is
 * dragged, since a field may be dropped beside any of them; where it may go
 * is the move rule's to say.
 */
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { FocusEvent, JSX, KeyboardEvent } from "react";
import { useMemo } from "react";

import type { BuilderFieldError } from "@admin/lib/builder/field-validators";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { VisibleRow } from "@admin/lib/builder/outline/outline-model";
import { isPendingDelete } from "@admin/lib/builder/outline/pending-rows";

import { AddPlace, withAddPlaces, type AddPlaceItem } from "./AddPlace";
import type { OutlineActions } from "./outline-types";
import { OutlineRow } from "./OutlineRow";

/** Where a pointer's add place puts the new field. */
function positionOf(place: AddPlaceItem): FieldInsertPosition {
  if (place.kind === "inside") return { parentFieldId: place.id };
  return {
    ...(place.parentId ? { parentFieldId: place.parentId } : {}),
    beforeFieldId: place.id,
  };
}

export function OutlineTree({
  rows,
  addable,
  finding,
  typeLabel,
  errors,
  selectedId,
  tabStopId,
  menuFor,
  actions,
  registerRow,
  onToggle,
  onAddAt,
  onKeyDown,
  onFocus,
  movesDescribedBy,
}: {
  rows: readonly VisibleRow[];
  /** Whether the places a field can be added are offered. */
  addable: boolean;
  finding: boolean;
  typeLabel: (type: string) => string;
  errors: ReadonlyMap<string, BuilderFieldError>;
  selectedId: string | null;
  tabStopId: string | null;
  menuFor: string | null;
  actions: OutlineActions;
  registerRow: (id: string, element: HTMLElement | null) => void;
  onToggle: (path: string) => void;
  onAddAt: (position: FieldInsertPosition) => void;
  onKeyDown: (event: KeyboardEvent<HTMLDivElement>) => void;
  onFocus: (event: FocusEvent<HTMLDivElement>) => void;
  /** The element naming the keys that move a field. */
  movesDescribedBy: string;
}): JSX.Element {
  const ids = useMemo(() => rows.map(row => row.node.id), [rows]);

  return (
    <SortableContext items={ids} strategy={verticalListSortingStrategy}>
      <div
        role="tree"
        aria-label="Fields"
        onKeyDown={onKeyDown}
        onFocus={onFocus}
        className="space-y-0.5"
      >
        {withAddPlaces(rows, addable).map(item => {
          if (item.kind !== "row") {
            return (
              <AddPlace
                key={item.key}
                place={item}
                onAdd={place => onAddAt(positionOf(place))}
              />
            );
          }
          const { node } = item.row;
          return (
            <OutlineRow
              key={node.id}
              row={item.row}
              typeName={node.typeName ?? typeLabel(node.field.type)}
              error={errors.get(node.id)?.message}
              selected={node.id === selectedId}
              tabStop={node.id === tabStopId}
              draggable={
                !finding &&
                node.own &&
                node.readOnly === null &&
                !isPendingDelete(node)
              }
              movesDescribedBy={movesDescribedBy}
              onSelect={actions.select}
              onToggle={onToggle}
              registerRow={registerRow}
              menuOpen={menuFor === node.id}
              actions={actions}
            />
          );
        })}
      </div>
    </SortableContext>
  );
}
