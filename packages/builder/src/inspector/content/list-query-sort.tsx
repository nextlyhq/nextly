"use client";

/**
 * A collection list's Sort: a row per key with its drag handle, field,
 * direction and menu, moved by drag or Alt+arrow, and the button that adds
 * one.
 *
 * @module list-query-sort
 */
import {
  LIST_MAX_SORT_KEYS,
  listKindSortable,
  type BlockNode,
  type ListFieldSource,
  type ListQuery,
  type ListSortKey,
} from "@nextlyhq/blocks-engine";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@nextlyhq/ui";
import { GripVertical, MoreHorizontal, Plus } from "lucide-react";
import * as React from "react";

import { ChoiceList } from "../../choice-list";

import { LoopPicker } from "./collection-loop-controls";
import type { LoopListField } from "./content-controls";
import {
  fieldList,
  fieldRow,
  LimitNote,
  listLimit,
  PUBLIC_ONLY,
  type FieldChoice,
} from "./list-query-filters";
import {
  directionWords,
  firstDirection,
  movedKey,
  sortValue,
} from "./list-query-model";
import { FieldError, GroupTitle } from "./list-query-parts";
import { partIssues } from "./list-query-reading";

/** Each key's React key: its field, and how many times it came before. */
function sortRowKeys(keys: readonly ListSortKey[]): string[] {
  const seen = new Map<string, number>();
  return keys.map(key => {
    const count = seen.get(key.field) ?? 0;
    seen.set(key.field, count + 1);
    return `${key.field}:${String(count)}`;
  });
}

/**
 * The index a dragged row lands at: the row under the pointer, asked of the
 * document rather than measured, so no rectangle is read here; `undefined`
 * where the pointer is over no row of this list.
 */
function dropIndex(
  list: HTMLElement,
  at: { readonly clientX: number; readonly clientY: number }
): number | undefined {
  const under = list.ownerDocument
    .elementFromPoint(at.clientX, at.clientY)
    ?.closest(".nx-list-sort");
  if (under === null || under === undefined || under.parentElement !== list) {
    return undefined;
  }
  return Array.from(list.children).indexOf(under);
}

/**
 * The step Alt+↑ or Alt+↓ moves a row, as Layers moves a block; nothing for
 * any other key.
 */
function altStep(event: React.KeyboardEvent): -1 | 1 | undefined {
  if (!event.altKey) return undefined;
  if (event.key === "ArrowUp") return -1;
  return event.key === "ArrowDown" ? 1 : undefined;
}

/** A key's field, from those a list may sort by; a lost one is marked. */
function SortFieldPicker({
  id,
  labelId,
  sortKey,
  field,
  fields,
  disabled,
  errorId,
  onField,
}: {
  id: string;
  labelId: string;
  sortKey: ListSortKey;
  field: LoopListField | undefined;
  fields: readonly LoopListField[];
  disabled: boolean;
  /** The id of the key's error, when it has one. */
  errorId: string | undefined;
  onField: (field: LoopListField) => void;
}): React.JSX.Element {
  return (
    <LoopPicker
      id={id}
      labelId={labelId}
      value={{
        words: field?.label ?? `${sortKey.field} · not in this collection`,
        state: field === undefined ? "unknown" : "value",
        invalid: errorId !== undefined,
        describedBy: errorId,
      }}
      disabled={disabled}
      list={fieldList(fields, sortKey.field, "Fields to sort by")}
      around={{ below: PUBLIC_ONLY }}
      onPick={choice => onField(choice.field)}
    />
  );
}

/** A key's direction, in the words its field's kind is ordered in. */
function DirectionPicker({
  name,
  words,
  descending,
  disabled,
  onDirection,
}: {
  name: string;
  words: { readonly ascending: string; readonly descending: string };
  descending: boolean;
  disabled: boolean;
  onDirection: (descending: boolean) => void;
}): React.JSX.Element {
  return (
    <Select
      value={descending ? "descending" : "ascending"}
      disabled={disabled}
      onValueChange={value => onDirection(value === "descending")}
    >
      <SelectTrigger
        size="sm"
        aria-label={`Order of ${name}`}
        className="nx-list-sort__direction"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="descending">{words.descending}</SelectItem>
        <SelectItem value="ascending">{words.ascending}</SelectItem>
      </SelectContent>
    </Select>
  );
}

/** A key's menu: move it up or down, with the keys that do so, or remove it. */
function SortRowMenu({
  name,
  index,
  count,
  disabled,
  onMove,
  onRemove,
}: {
  name: string;
  index: number;
  count: number;
  disabled: boolean;
  onMove: (to: number) => void;
  onRemove: () => void;
}): React.JSX.Element {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          aria-label={`More for sort by ${name}`}
          disabled={disabled}
        >
          <MoreHorizontal aria-hidden="true" size={14} />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem
          disabled={index === 0}
          onSelect={() => onMove(index - 1)}
        >
          Move up
          <kbd className="nx-list-query__kbd">Alt+↑</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={index === count - 1}
          onSelect={() => onMove(index + 1)}
        >
          Move down
          <kbd className="nx-list-query__kbd">Alt+↓</kbd>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={onRemove}>Remove</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** What a sort row's actions do to the stored keys. */
interface SortRowActions {
  readonly field: (field: LoopListField) => void;
  readonly direction: (descending: boolean) => void;
  readonly move: (to: number) => void;
  readonly remove: () => void;
  readonly dragStart: (event: React.PointerEvent<HTMLElement>) => void;
}

/** The handle a sort row is dragged by, which a pointer alone uses. */
function SortHandle({
  disabled,
  onDragStart,
}: {
  disabled: boolean;
  onDragStart: SortRowActions["dragStart"];
}): React.JSX.Element {
  return (
    <span
      className="nx-list-sort__handle"
      aria-hidden="true"
      title="Drag to reorder"
      onPointerDown={disabled ? undefined : onDragStart}
    >
      <GripVertical size={14} />
    </span>
  );
}

/** Alt+↑ and Alt+↓ on a sort row move it, unless the group is disabled. */
function altMover(
  disabled: boolean,
  index: number,
  move: SortRowActions["move"]
): (event: React.KeyboardEvent<HTMLElement>) => void {
  return event => {
    const step = disabled ? undefined : altStep(event);
    if (step === undefined) return;
    event.preventDefault();
    move(index + step);
  };
}

/** One sort key: handle, field, direction in words, and its menu. */
function SortRow({
  id,
  index,
  count,
  sortKey,
  fields,
  disabled,
  problem,
  dragging,
  on,
}: {
  id: string;
  index: number;
  count: number;
  sortKey: ListSortKey;
  fields: readonly LoopListField[];
  disabled: boolean;
  problem: string | undefined;
  dragging: boolean;
  on: SortRowActions;
}): React.JSX.Element {
  const field = fields.find(each => each.name === sortKey.field);
  const name = field?.label ?? sortKey.field;
  const labelId = `${id}-label`;
  // The row's error, by id, when it has one.
  const errorId = problem === undefined ? undefined : `${id}-error`;
  return (
    <li
      className="nx-list-sort"
      data-dragging={dragging ? "" : undefined}
      data-invalid={errorId === undefined ? undefined : ""}
      onKeyDown={altMover(disabled, index, on.move)}
    >
      <span id={labelId} className="nx-sr-only">
        {`Sort ${String(index + 1)} of ${String(count)}, by`}
      </span>
      <SortHandle disabled={disabled} onDragStart={on.dragStart} />
      <SortFieldPicker
        id={`${id}-field`}
        labelId={labelId}
        sortKey={sortKey}
        field={field}
        fields={fields}
        disabled={disabled}
        errorId={errorId}
        onField={on.field}
      />
      <DirectionPicker
        name={name}
        words={directionWords(field?.kind)}
        descending={sortKey.descending}
        disabled={disabled || field === undefined}
        onDirection={on.direction}
      />
      <SortRowMenu
        name={name}
        index={index}
        count={count}
        disabled={disabled}
        onMove={on.move}
        onRemove={on.remove}
      />
      {errorId === undefined ? null : (
        <FieldError id={errorId}>{problem}</FieldError>
      )}
    </li>
  );
}

/**
 * Focus the first sort row's field, or Add sort when there is no row, once
 * per new ask. After the frame the ask is drawn in, since the ask can move
 * the inspector to its Content tab in the same draw, which reveals the row.
 */
function useFocusOnAsk(
  group: React.RefObject<HTMLElement | null>,
  asked: number | undefined,
  firstFieldId: string
): void {
  const answered = React.useRef<number | undefined>(undefined);
  React.useEffect(() => {
    if (asked === undefined || asked === answered.current) return;
    const timer = setTimeout(() => {
      // Answered once it has run, not once it is scheduled: an effect run
      // again (React's StrictMode does so at once) clears the timer first, and
      // an ask already marked answered would then never be answered at all.
      answered.current = asked;
      const root = group.current;
      if (root === null) return;
      const target =
        root.ownerDocument.getElementById(firstFieldId) ??
        root.querySelector<HTMLElement>("[data-list-add-sort]");
      target?.scrollIntoView({ block: "nearest" });
      target?.focus();
    }, 0);
    return () => clearTimeout(timer);
  }, [group, asked, firstFieldId]);
}

/** The menu of fields a new sort key can order by. */
function AddSortButton({
  fields,
  disabled,
  describedBy,
  onPick,
}: {
  fields: readonly LoopListField[];
  disabled: boolean;
  /** The note saying why the button is off, when it is. */
  describedBy: string | undefined;
  onPick: (field: LoopListField) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const choices: FieldChoice[] = fields.map(each => ({
    key: each.name,
    label: each.label,
    field: each,
  }));
  return (
    <Popover open={open} onOpenChange={setOpen} modal={false}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="nx-list-query__add"
          // Where an ask to fix the sort lands when there is no row.
          data-list-add-sort=""
          disabled={disabled || fields.length === 0}
          aria-describedby={describedBy}
        >
          <Plus aria-hidden="true" size={14} />
          Add sort
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        sideOffset={4}
        className="nx-font-pick__popover"
        onOpenAutoFocus={event => event.preventDefault()}
      >
        <div className="nx-font-pick__body">
          <ChoiceList
            choices={choices}
            currentKey={undefined}
            label="Fields to sort by"
            searchLabel="Search fields"
            noMatch="No field matches."
            searchFrom={1}
            renderChoice={fieldRow}
            onPick={choice => {
              setOpen(false);
              onPick(choice.field);
            }}
          />
          {PUBLIC_ONLY}
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The Sort group: one row per key, in order, and a way to add one. */
export function SortGroup({
  id,
  query,
  node,
  fields,
  fieldSource,
  disabled,
  problems,
  fieldAsked,
  onSort,
}: {
  id: string;
  query: ListQuery;
  node: BlockNode;
  fields: readonly LoopListField[];
  fieldSource: ListFieldSource | undefined;
  disabled: boolean;
  problems: readonly string[];
  /** The count of the latest ask to fix this sort, from the canvas. */
  fieldAsked: number | undefined;
  onSort: (keys: readonly ListSortKey[]) => void;
}): React.JSX.Element {
  const keys = query.sort;
  const sortLimit = listLimit(keys.length, LIST_MAX_SORT_KEYS, id);
  const group = React.useRef<HTMLElement>(null);
  useFocusOnAsk(group, fieldAsked, `${id}-0-field`);
  const sortable = fields.filter(field => listKindSortable(field.kind));
  const rowKeys = sortRowKeys(keys);
  const list = React.useRef<HTMLOListElement>(null);
  const [drag, setDrag] = React.useState<{ from: number; to: number } | null>(
    null
  );
  const startDrag =
    (from: number) => (event: React.PointerEvent<HTMLElement>) => {
      const handle = event.currentTarget;
      const rows = list.current;
      if (rows === null) return;
      handle.setPointerCapture(event.pointerId);
      let to = from;
      setDrag({ from, to });
      const move = (moved: PointerEvent) => {
        to = dropIndex(rows, moved) ?? to;
        setDrag({ from, to });
      };
      const end = () => {
        handle.removeEventListener("pointermove", move);
        handle.removeEventListener("pointerup", end);
        handle.removeEventListener("pointercancel", end);
        setDrag(null);
        if (to !== from) onSort(movedKey(keys, from, to));
      };
      handle.addEventListener("pointermove", move);
      handle.addEventListener("pointerup", end);
      handle.addEventListener("pointercancel", end);
    };
  const shown = drag === null ? keys : movedKey(keys, drag.from, drag.to);
  const shownRowKeys =
    drag === null
      ? rowKeys
      : movedKey(
          rowKeys.map(each => ({ field: each, descending: false })),
          drag.from,
          drag.to
        ).map(each => each.field);
  const titleId = `${id}-title`;
  return (
    <section
      ref={group}
      className="nx-list-query__group"
      aria-labelledby={titleId}
    >
      <GroupTitle id={titleId}>Sort</GroupTitle>
      {shown.length === 0 ? (
        <p className="nx-inspector__note nx-list-query__hint">
          {query.relation === undefined
            ? "No sort: entries show in the order they were added."
            : "No sort: entries show in the order chosen on the entry."}
        </p>
      ) : (
        <ol ref={list} className="nx-list-query__sort" aria-label="Sort keys">
          {shown.map((key, index) => {
            const original = drag === null ? index : keys.indexOf(key);
            const problems = partIssues(
              node,
              { sort: sortValue([key]) },
              fieldSource
            );
            return (
              <SortRow
                key={shownRowKeys[index] ?? String(index)}
                id={`${id}-${String(index)}`}
                index={index}
                count={shown.length}
                sortKey={key}
                fields={sortable}
                disabled={disabled}
                problem={
                  problems.length === 0
                    ? undefined
                    : problems.map(issue => issue.message).join(" ")
                }
                dragging={drag !== null && drag.to === index}
                on={{
                  field: field =>
                    onSort(
                      keys.map((each, at) =>
                        at === index
                          ? { field: field.name, descending: each.descending }
                          : each
                      )
                    ),
                  direction: descending =>
                    onSort(
                      keys.map((each, at) =>
                        at === index ? { ...each, descending } : each
                      )
                    ),
                  move: to => {
                    if (to < 0 || to >= keys.length) return;
                    onSort(movedKey(keys, index, to));
                  },
                  remove: () => onSort(keys.filter((_, at) => at !== index)),
                  dragStart: startDrag(original),
                }}
              />
            );
          })}
        </ol>
      )}
      {problems.length === 0 ? null : (
        <FieldError id={`${id}-error`}>{problems.join(" ")}</FieldError>
      )}
      <AddSortButton
        fields={sortable.filter(
          field => !keys.some(key => key.field === field.name)
        )}
        // No key past the most a list sorts by, which the save refuses.
        disabled={disabled || sortLimit.full}
        describedBy={sortLimit.describedBy}
        onPick={field =>
          onSort([
            ...keys,
            { field: field.name, descending: firstDirection(field.kind) },
          ])
        }
      />
      <LimitNote limit={sortLimit}>Up to {LIST_MAX_SORT_KEYS} sorts.</LimitNote>
      {shown.length === 0 ? null : (
        <p className="nx-inspector__note nx-list-query__hint">
          Entries with the same values keep a fixed order. Entries with no value
          come last.
        </p>
      )}
    </section>
  );
}
