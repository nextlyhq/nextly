"use client";

/**
 * Move to…: every place a field could go, the top level and each container,
 * told apart as the rest of the Builder tells fields apart, with the position
 * to take there. A place the field may not go is listed too, disabled, with
 * the move rule's reason, so the list never hides why a place is missing; a
 * place inside repeating rows says where each entry's value goes.
 */
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@nextlyhq/ui";
import type { JSX } from "react";
import { useId, useMemo, useState } from "react";

import { distinguishFields } from "@admin/lib/builder/distinguishing-label";
import {
  findFieldById,
  findParentContainerId,
} from "@admin/lib/builder/field-transformers";
import type { FieldInsertPosition } from "@admin/lib/builder/insert-field";
import type { MoveDestination } from "@admin/lib/builder/move-rule";
import { spokenFieldName } from "@admin/lib/builder/move-words";

import type { BuilderField } from "../types";

import type { OutlineActions } from "./outline-types";

/** One position within a place: before a sibling, or the end. */
interface PlacePosition {
  key: string;
  label: string;
  beforeFieldId?: string;
}

/** The fields a place holds now, the moved field left out. */
function heldThere(
  fields: readonly BuilderField[],
  place: MoveDestination,
  fieldId: string
): readonly BuilderField[] {
  const container = place.path[place.path.length - 1];
  const list = container ? (container.fields ?? []) : fields;
  return list.filter(field => field.id !== fieldId && !field.isSystem);
}

/** The positions a place offers: at its start, then after each field in it. */
function positionsIn(siblings: readonly BuilderField[]): PlacePosition[] {
  if (siblings.length === 0)
    return [{ key: "end", label: "As its only field" }];
  return [
    { key: "start", label: "At the start", beforeFieldId: siblings[0]?.id },
    ...siblings.map((sibling, at) => {
      const next = siblings[at + 1];
      return {
        key: `after-${sibling.id}`,
        label: `After ${spokenFieldName(sibling)}`,
        ...(next ? { beforeFieldId: next.id } : {}),
      };
    }),
  ];
}

/** The position a field holds now in its own place, else the end. */
function currentPosition(
  fields: readonly BuilderField[],
  place: MoveDestination,
  fieldId: string,
  positions: readonly PlacePosition[]
): string {
  const container = place.path[place.path.length - 1];
  const list = container ? (container.fields ?? []) : fields;
  const at = list.findIndex(field => field.id === fieldId);
  if (at === -1) return positions[positions.length - 1]?.key ?? "end";
  const next = list.slice(at + 1).find(field => !field.isSystem);
  return (
    positions.find(position => position.beforeFieldId === next?.id)?.key ??
    "end"
  );
}

/** Where each entry's value goes, for a place inside repeating rows. */
function valuesSentence(rowsEntered: readonly string[]): string | null {
  if (rowsEntered.length === 0) return null;
  const [outer, ...inner] = rowsEntered;
  const within = inner.map(rows => `, then the first row of ${rows}`).join("");
  return `Each entry's value goes into the first row of ${outer}${within}; other rows start without it.`;
}

/** What a place is called: the top level, or the container told apart. */
function placeLabels(
  fields: readonly BuilderField[],
  places: readonly MoveDestination[]
): Map<string, string> {
  const told = new Map(
    distinguishFields(fields).map(entry => [entry.field.id, entry.text])
  );
  return new Map(
    places.map(place => [
      place.parentFieldId ?? "",
      place.parentFieldId
        ? (told.get(place.parentFieldId) ?? spokenFieldName(place.path.at(-1)))
        : "The top level",
    ])
  );
}

/** The place a field starts in: its own, where it already is; else the first it may go. */
function homeOf(
  fields: readonly BuilderField[],
  fieldId: string,
  places: readonly MoveDestination[]
): { own: string; home: string } {
  const own = findParentContainerId([...fields], fieldId)?.containerId ?? "";
  const ownAllowed = places.some(
    each => (each.parentFieldId ?? "") === own && each.verdict.allowed
  );
  const first = places.find(each => each.verdict.allowed)?.parentFieldId;
  return { own, home: ownAllowed ? own : (first ?? "") };
}

/** The place and position chosen, and what the rule says of a move there. */
function useMoveToChoice(
  fields: readonly BuilderField[],
  fieldId: string,
  actions: OutlineActions
) {
  const places = useMemo(
    () => actions.moveDestinations(fieldId),
    [actions, fieldId]
  );
  const { own, home } = useMemo(
    () => homeOf(fields, fieldId, places),
    [fields, fieldId, places]
  );
  const [chosen, setChosen] = useState<string>(home);
  const [positionKey, setPositionKey] = useState<string | null>(null);
  const place = places.find(each => (each.parentFieldId ?? "") === chosen);
  const positions = place ? positionsIn(heldThere(fields, place, fieldId)) : [];
  const now = place ? currentPosition(fields, place, fieldId, positions) : null;
  const position =
    positions.find(each => each.key === positionKey) ??
    positions.find(each => each.key === now);
  const target: FieldInsertPosition | null =
    place?.verdict.allowed && position
      ? {
          ...(place.parentFieldId
            ? { parentFieldId: place.parentFieldId }
            : {}),
          ...(position.beforeFieldId
            ? { beforeFieldId: position.beforeFieldId }
            : {}),
        }
      : null;
  return {
    places,
    chosen,
    choosePlace: (key: string) => {
      setChosen(key);
      setPositionKey(null);
    },
    placeAllowed: place?.verdict.allowed === true,
    positions,
    position,
    setPositionKey,
    target,
    verdict: target ? actions.judgeMoveTo(fieldId, target) : null,
    // Where it is already: nothing to move.
    stays: chosen === own && position?.key === now,
  };
}

/** One place to choose, disabled with the rule's reason when the field may not go there. */
function PlaceOption({
  place,
  label,
  name,
  checked,
  onChoose,
}: {
  place: MoveDestination;
  label: string;
  name: string;
  checked: boolean;
  onChoose: () => void;
}): JSX.Element {
  const inputId = useId();
  const noteId = `${inputId}-note`;
  const { verdict } = place;
  const note = verdict.allowed
    ? valuesSentence(verdict.repeatingRowsEntered)
    : verdict.message;
  return (
    <div className="flex items-start gap-2">
      <input
        type="radio"
        id={inputId}
        name={name}
        checked={checked}
        disabled={!verdict.allowed}
        aria-describedby={note ? noteId : undefined}
        onChange={onChoose}
        className="mt-1"
      />
      <div className="text-sm">
        <label
          htmlFor={inputId}
          className={verdict.allowed ? "" : "text-muted-foreground"}
        >
          {label}
        </label>
        {note && (
          <p id={noteId} className="text-xs text-muted-foreground">
            {note}
          </p>
        )}
      </div>
    </div>
  );
}

/** The position to take in the chosen place. */
function PositionPicker({
  positions,
  value,
  onChange,
}: {
  positions: readonly PlacePosition[];
  value: string;
  onChange: (key: string) => void;
}): JSX.Element {
  const id = useId();
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-sm font-medium">
        Position
      </label>
      <select
        id={id}
        value={value}
        onChange={event => onChange(event.target.value)}
        className="block w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
      >
        {positions.map(each => (
          <option key={each.key} value={each.key}>
            {each.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function MoveToDialog({
  fieldId,
  fields,
  actions,
  onClose,
}: {
  fieldId: string;
  fields: readonly BuilderField[];
  actions: OutlineActions;
  onClose: () => void;
}): JSX.Element {
  const name = useId();
  const choice = useMoveToChoice(fields, fieldId, actions);
  const labels = useMemo(
    () => placeLabels(fields, choice.places),
    [fields, choice.places]
  );
  const { target, verdict } = choice;

  return (
    <Dialog open onOpenChange={open => !open && onClose()}>
      <DialogContent
        className="max-w-xl"
        // Back on the field, wherever it went, rather than on the menu item
        // that opened this, which is gone.
        onCloseAutoFocus={event => {
          event.preventDefault();
          actions.focusRow(fieldId);
        }}
      >
        <DialogHeader>
          <DialogTitle>
            Move {spokenFieldName(findFieldById([...fields], fieldId))} to…
          </DialogTitle>
          <DialogDescription>
            Choose a place and a position there. A place it cannot go says why.
          </DialogDescription>
        </DialogHeader>
        <fieldset className="max-h-80 space-y-2 overflow-y-auto">
          <legend className="sr-only">Place</legend>
          {choice.places.map(place => {
            const key = place.parentFieldId ?? "";
            return (
              <PlaceOption
                key={key || "top"}
                place={place}
                label={labels.get(key) ?? ""}
                name={name}
                checked={choice.chosen === key}
                onChoose={() => choice.choosePlace(key)}
              />
            );
          })}
        </fieldset>
        {choice.placeAllowed && (
          <PositionPicker
            positions={choice.positions}
            value={choice.position?.key ?? ""}
            onChange={choice.setPositionKey}
          />
        )}
        {verdict && !verdict.allowed && (
          <p role="alert" className="text-sm text-destructive">
            {verdict.message}
          </p>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!target || !verdict?.allowed || choice.stays}
            onClick={() => {
              if (target) actions.moveTo(fieldId, target);
            }}
          >
            Move
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
