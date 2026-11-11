"use client";

/**
 * The tree itself: the rows to draw, with the places a field can be added
 * among them, inside the drag context that lets a field move within its own
 * container and nowhere else.
 */
import {
  SortableContext,
  verticalListSortingStrategy,
  type SortingStrategy,
} from "@dnd-kit/sortable";
import type { FocusEvent, JSX, KeyboardEvent } from "react";
import { useMemo } from "react";

import type { BuilderFieldError } from "@admin/lib/builder/field-validators";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { VisibleRow } from "@admin/lib/builder/outline/outline-model";

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

/**
 * While dragging, only rows in the dragged row's own container make way: a
 * field moves within its container, and nowhere else.
 */
function sameContainerStrategy(rows: readonly VisibleRow[]): SortingStrategy {
  const parentOf = (i: number) => rows[i]?.node.parentId ?? null;
  return args =>
    parentOf(args.index) === parentOf(args.activeIndex) &&
    parentOf(args.overIndex) === parentOf(args.activeIndex)
      ? verticalListSortingStrategy(args)
      : null;
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
}): JSX.Element {
  const ids = useMemo(() => rows.map(row => row.node.id), [rows]);
  const strategy = useMemo(() => sameContainerStrategy(rows), [rows]);

  return (
    <SortableContext items={ids} strategy={strategy}>
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
              typeName={typeLabel(node.field.type)}
              error={errors.get(node.id)?.message}
              selected={node.id === selectedId}
              tabStop={node.id === tabStopId}
              draggable={!finding && node.own && node.readOnly === null}
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
