"use client";

/**
 * A collection loop's Content-tab controls: which collection it repeats over,
 * and the order its entries come in.
 *
 * Both props stay text, as stored. A block asks for these controls with
 * `display: "collection"` on the prop naming a collection, and
 * `display: "sort"` with `collectionProp` on the prop holding its sort keys,
 * so nobody types a slug or a field name from memory.
 *
 * The collections, and each one's sortable fields, are read through the
 * host's `listLoopCollections`, once for both controls. Where the host lends
 * none, or the read fails, each prop falls back to the text field it always
 * had, so a loop is never left without a way to be set.
 *
 * A stored value the list does not hold (a collection since removed or not
 * readable by this author, a field the collection no longer has) is still
 * shown, marked, and kept until the author picks another: the control never
 * rewrites what it cannot represent.
 *
 * @module collection-loop-controls
 */

import {
  Button,
  Label,
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@nextlyhq/ui";
import { ArrowDown, ArrowUp, ChevronDown } from "lucide-react";
import * as React from "react";

import { ChoiceList, type ListedChoice } from "./choice-list";
import type {
  ContentControlProps,
  LoopCollection,
  LoopSortField,
} from "./content-controls";
import { propLabel } from "./inspector";
import { readSort, restKeys, writeSort, type SortKey } from "./loop-sort";

type ListLoopCollections = NonNullable<
  NonNullable<ContentControlProps["services"]>["listLoopCollections"]
>;

/** The host's answer, as the controls hold it. */
type LoopCollections =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly collections: readonly LoopCollection[] }
  | { readonly kind: "failed" };

/**
 * The read in flight, per host function. Shared only while it is in flight,
 * so the collection and sort controls drawn together make one read, and
 * dropped the moment it settles. An answer is one signed-in author's, read
 * with their access: kept past that, it could be handed to whoever signs in
 * next on the same tab without the route judging them.
 */
const inFlight = new WeakMap<
  ListLoopCollections,
  Promise<readonly LoopCollection[]>
>();

/** The host's collections, read once for every control asking while it runs. */
function readShared(
  list: ListLoopCollections
): Promise<readonly LoopCollection[]> {
  const held = inFlight.get(list);
  if (held !== undefined) return held;
  const answer = list();
  inFlight.set(list, answer);
  const settle = () => {
    if (inFlight.get(list) === answer) inFlight.delete(list);
  };
  answer.then(settle, settle);
  return answer;
}

/** The collections, or `undefined` when the host lends no way to list them. */
function useLoopCollections(
  list: ListLoopCollections | undefined
): LoopCollections | undefined {
  const [found, setFound] = React.useState<{
    readonly list: ListLoopCollections;
    readonly answer: LoopCollections;
  }>();
  React.useEffect(() => {
    if (list === undefined) return;
    let live = true;
    readShared(list).then(
      collections => {
        if (live) setFound({ list, answer: { kind: "ready", collections } });
      },
      () => {
        if (live) setFound({ list, answer: { kind: "failed" } });
      }
    );
    return () => {
      live = false;
    };
  }, [list]);
  if (list === undefined) return undefined;
  // The answer for THIS function only, so a host swapped mid-mount never
  // shows the previous host's collections.
  return found?.list === list ? found.answer : { kind: "loading" };
}

/** A stored text value, trimmed, or `undefined` for anything else or nothing. */
function storedName(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

/** What each control is given beyond a content control's own props. */
interface LoopControlProps extends ContentControlProps {
  /** The plain text field, drawn when the collections cannot be listed. */
  readonly fallback: React.ReactNode;
}

/** One row of a loop picker's list. */
interface LoopChoice extends ListedChoice {
  /** What picking it writes; `undefined` removes the prop. */
  readonly value: string | undefined;
}

/**
 * The button that shows a loop prop's value, and the list it opens: searched
 * once long. Its name is the field's label and its value together, so a
 * screen reader hears "Collection, Blog posts".
 */
function LoopPicker({
  id,
  labelId,
  shown,
  state,
  disabled,
  choices,
  currentKey,
  listLabel,
  searchLabel,
  noMatch,
  searchFrom,
  onPick,
}: {
  id: string;
  labelId: string;
  /** The words the button shows. */
  shown: string;
  /** Whether they are a prompt, or a stored value the list does not hold. */
  state: "value" | "prompt" | "unknown";
  disabled: boolean;
  choices: readonly LoopChoice[];
  currentKey: string;
  listLabel: string;
  searchLabel: string;
  noMatch: string;
  searchFrom?: number;
  onPick: (choice: LoopChoice) => void;
}): React.JSX.Element {
  const [open, setOpen] = React.useState(false);
  const valueId = `${id}-value`;
  return (
    <div
      className="nx-font-pick"
      data-unknown={state === "unknown" ? "" : undefined}
    >
      <Popover open={open} onOpenChange={setOpen} modal={false}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={id}
            className="nx-font-pick__trigger"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-labelledby={`${labelId} ${valueId}`}
            disabled={disabled}
          >
            <span
              id={valueId}
              className="nx-font-pick__value"
              data-placeholder={state === "prompt" ? "" : undefined}
              title={shown}
            >
              {shown}
            </span>
            <ChevronDown aria-hidden="true" size={14} />
          </button>
        </PopoverTrigger>
        {/* Aligned to the control's right edge, as the font list is: the list
            may be wider than the control, at the window's right edge. */}
        <PopoverContent
          align="end"
          sideOffset={4}
          className="nx-font-pick__popover"
          onOpenAutoFocus={event => event.preventDefault()}
        >
          <div className="nx-font-pick__body">
            <ChoiceList
              choices={choices}
              currentKey={currentKey}
              label={listLabel}
              searchLabel={searchLabel}
              noMatch={noMatch}
              {...(searchFrom === undefined ? {} : { searchFrom })}
              onPick={choice => {
                setOpen(false);
                onPick(choice);
              }}
            />
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}

/**
 * How many collections the list holds before it offers a search. The list
 * has one row more than that, "No collection", which the count leaves out.
 */
const COLLECTIONS_SEARCH_FROM = 10;

/** The host's answer once it is one the controls can draw from. */
type DrawnCollections = Exclude<LoopCollections, { kind: "failed" }>;

/** What a loop control draws with, once the host's list can be drawn from. */
interface DrawnLoopProps extends LoopControlProps {
  readonly listed: DrawnCollections;
  /** The id of the label naming the field. */
  readonly labelId: string;
  /** What the label says. */
  readonly name: string;
}

/**
 * A loop control that draws from the host's collections, or the plain text
 * field where it lends none or its read failed.
 */
function withLoopCollections(
  Drawn: (props: DrawnLoopProps) => React.JSX.Element
): (props: LoopControlProps) => React.JSX.Element {
  return function LoopControl(props: LoopControlProps): React.JSX.Element {
    const listed = useLoopCollections(props.services?.listLoopCollections);
    if (listed === undefined || listed.kind === "failed") {
      return <>{props.fallback}</>;
    }
    return (
      <Drawn
        {...props}
        listed={listed}
        labelId={`${props.id}-label`}
        name={props.label ?? propLabel(props.prop.name, props.prop.schema)}
      />
    );
  };
}

/** The collections in the order the list offers them: by name, ignoring case. */
function alphabetical(
  collections: readonly LoopCollection[]
): LoopCollection[] {
  return [...collections].sort(
    (a, b) =>
      a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0)
  );
}

/** What a picker's button shows, and whether it is a prompt or a lost value. */
interface Shown {
  readonly words: string;
  readonly state: "value" | "prompt" | "unknown";
}

/** What the collection button shows for the stored slug. */
function collectionShown(
  listed: DrawnCollections,
  stored: string | undefined,
  current: LoopCollection | undefined
): Shown {
  if (listed.kind === "loading") {
    return { words: "Loading collections…", state: "prompt" };
  }
  if (stored === undefined) {
    return { words: "Choose a collection", state: "prompt" };
  }
  return current === undefined
    ? { words: `${stored} · not available`, state: "unknown" }
    : { words: current.label, state: "value" };
}

/** The collection picker, once the host's list can be drawn from. */
function CollectionField({
  id,
  prop,
  disabled,
  onCommit,
  listed,
  labelId,
  name,
}: DrawnLoopProps): React.JSX.Element {
  const stored = storedName(prop.value);
  const collections =
    listed.kind === "ready" ? alphabetical(listed.collections) : [];
  const current = collections.find(each => each.slug === stored);
  const shown = collectionShown(listed, stored, current);
  const choices: LoopChoice[] = [
    { key: "", label: "No collection", value: undefined },
    ...collections.map(each => ({
      key: each.slug,
      label: each.label,
      value: each.slug,
    })),
  ];
  return (
    <div
      className="nx-inspector__field"
      data-content-control={prop.schema.type}
      data-display="collection"
    >
      <Label id={labelId} htmlFor={id}>
        {name}
      </Label>
      <LoopPicker
        id={id}
        labelId={labelId}
        shown={shown.words}
        state={shown.state}
        disabled={disabled || listed.kind === "loading"}
        choices={choices}
        currentKey={stored ?? ""}
        listLabel="Collections"
        searchLabel="Search collections"
        noMatch="No collection matches."
        searchFrom={COLLECTIONS_SEARCH_FROM + 1}
        onPick={choice => {
          if (choice.value !== stored) onCommit(prop.name, choice.value);
        }}
      />
    </div>
  );
}

/**
 * The collection a loop repeats over, chosen from the site's collections
 * rather than typed as a slug.
 */
export const CollectionControl: (props: LoopControlProps) => React.JSX.Element =
  withLoopCollections(CollectionField);

/** A collection's sortable fields as the menu lists them: dates first. */
function datesFirst(fields: readonly LoopSortField[]): LoopSortField[] {
  return [
    ...fields.filter(field => field.date),
    ...fields.filter(field => !field.date),
  ];
}

/** A key's field in words: its label where the collection has it. */
function fieldWords(
  field: string,
  fields: readonly LoopSortField[]
): string | undefined {
  return fields.find(each => each.name === field)?.label;
}

/** The collection the sort's block names in its `collectionProp`, if any. */
function sortedCollection(
  prop: DrawnLoopProps["prop"],
  values: DrawnLoopProps["values"]
): string | undefined {
  const from = prop.schema.collectionProp;
  return typeof from === "string" ? storedName(values?.[from]) : undefined;
}

/** The fields of `collection` the menu offers, dates first; none while loading. */
function sortFieldsFor(
  listed: DrawnCollections,
  collection: string | undefined
): LoopSortField[] {
  if (listed.kind !== "ready") return [];
  const found = listed.collections.find(each => each.slug === collection);
  return datesFirst(found?.sortFields ?? []);
}

/** What the sort button shows for the stored first key. */
function sortShown(
  waiting: boolean,
  first: SortKey | undefined,
  collection: string | undefined,
  fields: readonly LoopSortField[]
): Shown {
  if (waiting) return { words: "Loading fields…", state: "prompt" };
  if (first === undefined) {
    return {
      words:
        collection === undefined
          ? "Choose a collection first"
          : "Default order",
      state: "prompt",
    };
  }
  const known = fieldWords(first.field, fields);
  return known === undefined
    ? { words: `${first.field} · not in this collection`, state: "unknown" }
    : { words: known, state: "value" };
}

/**
 * The key a pick in the sort menu stores, or `undefined` for Default order.
 * A field changed keeps the direction already chosen; a field newly chosen
 * sorts newest first for a date, as a list of posts is most often read, and
 * A to Z for anything else.
 */
function pickedKey(
  picked: string | undefined,
  fields: readonly LoopSortField[],
  first: SortKey | undefined
): SortKey | undefined {
  const field = fields.find(each => each.name === picked);
  if (field === undefined) return undefined;
  return { field: field.name, descending: first?.descending ?? field.date };
}

/** The direction toggle beside the sort menu: pressed is descending. */
function DirectionToggle({
  descending,
  disabled,
  onFlip,
}: {
  descending: boolean;
  disabled: boolean;
  onFlip: () => void;
}): React.JSX.Element {
  return (
    <Button
      type="button"
      size="icon-sm"
      variant="outline"
      className="nx-inspector__sort-direction"
      // Named for the pressed state, so "Descending, pressed" and
      // "Descending, not pressed" both read true.
      aria-label="Descending"
      aria-pressed={descending}
      title={descending ? "Descending" : "Ascending"}
      disabled={disabled}
      onClick={onFlip}
    >
      {descending ? (
        <ArrowDown aria-hidden="true" />
      ) : (
        <ArrowUp aria-hidden="true" />
      )}
    </Button>
  );
}

/**
 * The line naming the stored keys after the first: kept as they are where
 * the collection can sort by them, and marked where it cannot, since the
 * next change drops those (see `loop-sort`).
 */
function FurtherKeys({
  keys,
  fields,
}: {
  keys: readonly SortKey[];
  fields: readonly LoopSortField[];
}): React.JSX.Element | null {
  if (keys.length === 0) return null;
  let lost = false;
  const words = keys.map(key => {
    const known = fieldWords(key.field, fields);
    if (known === undefined) lost = true;
    const field = known ?? `${key.field} · not in this collection`;
    return key.descending ? `${field} (descending)` : field;
  });
  return (
    <p className="nx-inspector__note">
      Then by {words.join(", ")}.
      {lost
        ? " A key not in this collection is dropped at the next change."
        : null}
    </p>
  );
}

/** The sort menu and its direction, once the host's list can be drawn from. */
function SortField({
  id,
  prop,
  disabled,
  onCommit,
  values,
  listed,
  labelId,
  name,
}: DrawnLoopProps): React.JSX.Element {
  const collection = sortedCollection(prop, values);
  const fields = sortFieldsFor(listed, collection);
  const stored = readSort(prop.value);
  const first = stored.first;
  const waiting = listed.kind === "loading";
  const shown = sortShown(waiting, first, collection, fields);
  const commit = (next: SortKey | undefined) => {
    const written = writeSort(stored, next, field =>
      fields.some(each => each.name === field)
    );
    if (written !== storedName(prop.value)) onCommit(prop.name, written);
  };
  const choices: LoopChoice[] = [
    { key: "", label: "Default order", value: undefined },
    ...fields.map(field => ({
      key: field.name,
      label: field.label,
      value: field.name,
    })),
  ];
  return (
    <div
      className="nx-inspector__field"
      data-content-control={prop.schema.type}
      data-display="sort"
    >
      <Label id={labelId} htmlFor={id}>
        {name}
      </Label>
      <div className="nx-inspector__sort">
        <LoopPicker
          id={id}
          labelId={labelId}
          shown={shown.words}
          state={shown.state}
          // A stored sort stays reachable without a collection, so it can be
          // cleared; with neither, there is nothing to choose from yet.
          disabled={
            disabled ||
            waiting ||
            (collection === undefined && first === undefined)
          }
          choices={choices}
          currentKey={first?.field ?? ""}
          listLabel="Fields to sort by"
          searchLabel="Search fields"
          noMatch="No field matches."
          onPick={choice => commit(pickedKey(choice.value, fields, first))}
        />
        <DirectionToggle
          descending={first?.descending === true}
          disabled={disabled || waiting || first === undefined}
          onFlip={() => {
            if (first !== undefined) {
              commit({ field: first.field, descending: !first.descending });
            }
          }}
        />
      </div>
      <FurtherKeys keys={restKeys(stored)} fields={fields} />
    </div>
  );
}

/**
 * The order a loop's entries come in: a field of its collection, and which
 * way, on one row. Only the first stored key is edited here; see `loop-sort`
 * for why further keys are kept as they are.
 */
export const SortControl: (props: LoopControlProps) => React.JSX.Element =
  withLoopCollections(SortField);
